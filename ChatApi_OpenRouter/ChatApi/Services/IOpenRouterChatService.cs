using ChatApi.Models;

namespace ChatApi.Services;

public interface IOpenRouterChatService
{
    /// <summary>
    /// Returns the full assistant reply as a single string (non-streaming).
    /// Demonstrates: Chat Completion API + Error Handling.
    /// </summary>
    Task<string> GetReplyAsync(
        IReadOnlyList<ChatMessage> messages,
        string? modelOverride = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Yields assistant reply tokens one chunk at a time via SSE streaming.
    /// Demonstrates: Streaming Responses.
    /// </summary>
    IAsyncEnumerable<string> GetReplyStreamAsync(
        IReadOnlyList<ChatMessage> messages,
        string? modelOverride = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns a curated list of models available on OpenRouter.
    /// Demonstrates: API Integration — discovery endpoint.
    /// </summary>
    Task<IReadOnlyList<ModelInfo>> GetAvailableModelsAsync(
        CancellationToken cancellationToken = default);
}
