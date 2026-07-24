using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using ChatApi.Models;
using Microsoft.Extensions.Options;

namespace ChatApi.Services;

/// <summary>
/// Calls the OpenRouter Chat Completions endpoint (OpenAI-compatible API).
/// Demonstrates:
///   - API Authentication  : Bearer token added to every request header.
///   - Chat Completion API : POST /api/v1/chat/completions with messages array.
///   - Streaming Responses : stream=true + Server-Sent Events parsed line-by-line.
///   - Error Handling      : HTTP errors are surfaced with structured messages.
///   - Model Selection     : Optional per-request model override.
/// </summary>
public class OpenRouterChatService : IOpenRouterChatService
{
    private const string ChatEndpoint   = "https://openrouter.ai/api/v1/chat/completions";
    private const string ModelsEndpoint = "https://openrouter.ai/api/v1/models";

    private readonly HttpClient _httpClient;
    private readonly OpenRouterOptions _options;
    private readonly IKnowledgeService _knowledge;

    public OpenRouterChatService(
        HttpClient httpClient,
        IOptions<OpenRouterOptions> options,
        IKnowledgeService knowledge)
    {
        _httpClient = httpClient;
        _options    = options.Value;
        _knowledge  = knowledge;
    }

    // ─────────────────────────────────────────────────────────────
    // Non-streaming: Chat Completion API
    // ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Sends a list of messages and waits for the full assistant reply.
    /// Uses the standard (non-streaming) Chat Completion endpoint.
    /// </summary>
    public async Task<string> GetReplyAsync(
        IReadOnlyList<ChatMessage> messages,
        string? modelOverride = null,
        CancellationToken cancellationToken = default)
    {
        ValidateApiKey();

        var model = !string.IsNullOrWhiteSpace(modelOverride) ? modelOverride : _options.Model;

        var requestBody = new OpenRouterChatRequest
        {
            Model    = model,
            Messages = await BuildMessagesWithKnowledgeAsync(messages, cancellationToken),
            Stream   = false
        };

        using var httpRequest = BuildHttpRequest(requestBody);
        using var response    = await _httpClient.SendAsync(httpRequest, cancellationToken);

        // ── Error Handling ──────────────────────────────────────
        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException(FormatOpenRouterError((int)response.StatusCode, errorBody));
        }

        var payload = await response.Content.ReadFromJsonAsync<OpenRouterChatResponse>(
            cancellationToken: cancellationToken);

        var text = payload?.Choices?.FirstOrDefault()?.Message?.Content;

        if (string.IsNullOrWhiteSpace(text))
            throw new InvalidOperationException("OpenRouter API returned an empty response.");

        return text.Trim();
    }

    // ─────────────────────────────────────────────────────────────
    // Streaming: Server-Sent Events (SSE)
    // ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Sends a list of messages and yields each text delta as it arrives
    /// from the model, using OpenAI-compatible Server-Sent Events streaming.
    /// </summary>
    public async IAsyncEnumerable<string> GetReplyStreamAsync(
        IReadOnlyList<ChatMessage> messages,
        string? modelOverride = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ValidateApiKey();

        var model = !string.IsNullOrWhiteSpace(modelOverride) ? modelOverride : _options.Model;

        var requestBody = new OpenRouterChatRequest
        {
            Model    = model,
            Messages = await BuildMessagesWithKnowledgeAsync(messages, cancellationToken),
            Stream   = true
        };

        using var httpRequest = BuildHttpRequest(requestBody);

        using var response = await _httpClient.SendAsync(
            httpRequest,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);

        // ── Error Handling ──────────────────────────────────────
        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException(FormatOpenRouterError((int)response.StatusCode, errorBody));
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var reader       = new StreamReader(stream);

        string? line;
        while ((line = await reader.ReadLineAsync(cancellationToken)) is not null
               && !cancellationToken.IsCancellationRequested)
        {
            if (string.IsNullOrEmpty(line))
                continue;

            if (!line.StartsWith("data: ", StringComparison.Ordinal))
                continue;

            var json = line["data: ".Length..].Trim();

            if (json == "[DONE]")
                yield break;

            OpenRouterStreamChunk? chunk;
            try
            {
                chunk = JsonSerializer.Deserialize<OpenRouterStreamChunk>(json);
            }
            catch (JsonException)
            {
                continue;
            }

            var delta = chunk?.Choices?.FirstOrDefault()?.Delta?.Content;
            if (!string.IsNullOrEmpty(delta))
                yield return delta;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Model Discovery
    // ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Fetches available models from OpenRouter and returns a curated subset.
    /// Demonstrates: API Authentication applied to a discovery endpoint.
    /// </summary>
    public async Task<IReadOnlyList<ModelInfo>> GetAvailableModelsAsync(
        CancellationToken cancellationToken = default)
    {
        ValidateApiKey();

        using var request = new HttpRequestMessage(HttpMethod.Get, ModelsEndpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);

        if (!string.IsNullOrWhiteSpace(_options.SiteUrl))
            request.Headers.Add("HTTP-Referer", _options.SiteUrl);
        if (!string.IsNullOrWhiteSpace(_options.SiteName))
            request.Headers.Add("X-Title", _options.SiteName);

        using var response = await _httpClient.SendAsync(request, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            // Return a safe fallback list so the UI always has options
            return GetFallbackModels();
        }

        try
        {
            var payload = await response.Content.ReadFromJsonAsync<OpenRouterModelsResponse>(
                cancellationToken: cancellationToken);

            if (payload?.Data is null || payload.Data.Count == 0)
                return GetFallbackModels();

            // Filter to text-generation models and sort by id
            return payload.Data
                .Where(m => !string.IsNullOrWhiteSpace(m.Id))
                .OrderBy(m => m.Id)
                .Select(m => new ModelInfo(m.Id!, m.Name ?? m.Id!, m.Description))
                .ToList()
                .AsReadOnly();
        }
        catch (JsonException)
        {
            return GetFallbackModels();
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────

    private static IReadOnlyList<ModelInfo> GetFallbackModels() =>
    [
        new("openai/gpt-4o-mini",              "GPT-4o Mini",         "Fast and cost-efficient"),
        new("openai/gpt-4o",                   "GPT-4o",              "Multimodal flagship"),
        new("anthropic/claude-3.5-sonnet",     "Claude 3.5 Sonnet",   "Balanced intelligence"),
        new("anthropic/claude-3-haiku",        "Claude 3 Haiku",      "Fast and compact"),
        new("google/gemini-flash-1.5",         "Gemini Flash 1.5",    "Google's fast model"),
        new("meta-llama/llama-3.1-8b-instruct","Llama 3.1 8B",        "Open-source, fast"),
        new("mistralai/mistral-7b-instruct",   "Mistral 7B Instruct", "Efficient instruction model"),
    ];

    private void ValidateApiKey()
    {
        if (string.IsNullOrWhiteSpace(_options.ApiKey))
            throw new InvalidOperationException(
                "OpenRouter API key is not configured. " +
                "Set OpenRouter:ApiKey in appsettings or user secrets.");
    }

    /// <summary>
    /// Builds the outgoing HttpRequestMessage with API Authentication headers.
    /// API Authentication: Authorization: Bearer {ApiKey}
    /// </summary>
    private HttpRequestMessage BuildHttpRequest(OpenRouterChatRequest body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, ChatEndpoint)
        {
            Content = JsonContent.Create(body)
        };

        // ── API Authentication ──────────────────────────────────
        request.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", _options.ApiKey);

        if (!string.IsNullOrWhiteSpace(_options.SiteUrl))
            request.Headers.Add("HTTP-Referer", _options.SiteUrl);

        if (!string.IsNullOrWhiteSpace(_options.SiteName))
            request.Headers.Add("X-Title", _options.SiteName);

        return request;
    }

    private static string FormatOpenRouterError(int statusCode, string errorBody)
    {
        try
        {
            using var document = JsonDocument.Parse(errorBody);
            var message = document.RootElement
                .GetProperty("error")
                .GetProperty("message")
                .GetString();

            if (!string.IsNullOrWhiteSpace(message))
                return $"OpenRouter API returned {statusCode}: {message}";
        }
        catch (JsonException) { }

        return $"OpenRouter API returned {statusCode}: {errorBody}";
    }

    private async Task<List<OpenRouterMessage>> BuildMessagesWithKnowledgeAsync(
        IReadOnlyList<ChatMessage> messages,
        CancellationToken cancellationToken)
    {
        var mapped = new List<OpenRouterMessage>();
        bool enableOfficeDetails = false;

        foreach (var msg in messages)
        {
            var content = msg.Content ?? string.Empty;
            var role = msg.Role;

            if (role.Equals("user", StringComparison.OrdinalIgnoreCase))
            {
                var trimmed = content.TrimStart();
                if (trimmed.StartsWith("/office", StringComparison.OrdinalIgnoreCase))
                {
                    enableOfficeDetails = true;
                    content = trimmed["/office".Length..].TrimStart();
                }
            }

            mapped.Add(new OpenRouterMessage 
            { 
                Role = role.ToLowerInvariant(), 
                Content = content 
            });
        }

        if (enableOfficeDetails)
        {
            var knowledge = await _knowledge.GetKnowledgeAsync(cancellationToken);
            if (!string.IsNullOrWhiteSpace(knowledge))
            {
                mapped.Insert(0, new OpenRouterMessage { Role = "system", Content = knowledge });
            }
        }

        return mapped;
    }

    private static OpenRouterMessage MapMessage(ChatMessage message)
    {
        var role = message.Role.ToLowerInvariant() switch
        {
            "assistant" => "assistant",
            "user"      => "user",
            "system"    => "system",
            _           => throw new ArgumentException($"Unsupported role: {message.Role}")
        };

        return new OpenRouterMessage { Role = role, Content = message.Content };
    }

    // ─────────────────────────────────────────────────────────────
    // Private DTOs — non-streaming
    // ─────────────────────────────────────────────────────────────

    private sealed class OpenRouterChatRequest
    {
        [JsonPropertyName("model")]
        public string Model { get; set; } = string.Empty;

        [JsonPropertyName("messages")]
        public List<OpenRouterMessage> Messages { get; set; } = [];

        [JsonPropertyName("stream")]
        public bool Stream { get; set; }
    }

    private sealed class OpenRouterMessage
    {
        [JsonPropertyName("role")]
        public string Role { get; set; } = "user";

        [JsonPropertyName("content")]
        public string Content { get; set; } = string.Empty;
    }

    private sealed class OpenRouterChatResponse
    {
        [JsonPropertyName("choices")]
        public List<OpenRouterChoice>? Choices { get; set; }
    }

    private sealed class OpenRouterChoice
    {
        [JsonPropertyName("message")]
        public OpenRouterMessage? Message { get; set; }
    }

    // ─────────────────────────────────────────────────────────────
    // Private DTOs — streaming / SSE
    // ─────────────────────────────────────────────────────────────

    private sealed class OpenRouterStreamChunk
    {
        [JsonPropertyName("choices")]
        public List<OpenRouterStreamChoice>? Choices { get; set; }
    }

    private sealed class OpenRouterStreamChoice
    {
        [JsonPropertyName("delta")]
        public OpenRouterDelta? Delta { get; set; }
    }

    private sealed class OpenRouterDelta
    {
        [JsonPropertyName("content")]
        public string? Content { get; set; }
    }

    // ─────────────────────────────────────────────────────────────
    // Private DTOs — models discovery
    // ─────────────────────────────────────────────────────────────

    private sealed class OpenRouterModelsResponse
    {
        [JsonPropertyName("data")]
        public List<OpenRouterModelItem>? Data { get; set; }
    }

    private sealed class OpenRouterModelItem
    {
        [JsonPropertyName("id")]
        public string? Id { get; set; }

        [JsonPropertyName("name")]
        public string? Name { get; set; }

        [JsonPropertyName("description")]
        public string? Description { get; set; }
    }
}
