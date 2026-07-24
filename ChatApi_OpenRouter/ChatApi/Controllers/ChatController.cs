using ChatApi.Models;
using ChatApi.Services;
using Microsoft.AspNetCore.Mvc;

namespace ChatApi.Controllers;

/// <summary>
/// Exposes three endpoints demonstrating all OpenAI API concepts:
///
///  POST /api/chat          — Chat Completion (non-streaming) + Error Handling
///  POST /api/chat/stream   — Streaming Responses via Server-Sent Events
///  GET  /api/chat/models   — Model Discovery (available OpenRouter models)
///
/// API Authentication is applied to every outgoing request inside the service.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class ChatController : ControllerBase
{
    private readonly IOpenRouterChatService _chatService;

    public ChatController(IOpenRouterChatService chatService)
    {
        _chatService = chatService;
    }

    // ─────────────────────────────────────────────────────────────
    // POST /api/chat
    // Demonstrates: Chat Completion API + Error Handling
    // ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Sends a list of chat messages and returns the full assistant reply
    /// once the model finishes generating (non-streaming).
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<ChatResponse>> Post(
        [FromBody] ChatRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Messages is null || request.Messages.Count == 0)
            return BadRequest(new { error = "At least one message is required." });

        try
        {
            var reply = await _chatService.GetReplyAsync(
                request.Messages,
                request.Model,
                cancellationToken);
            return Ok(new ChatResponse(reply));
        }
        // ── Error Handling ──────────────────────────────────────────
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = ex.Message });
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new { error = ex.Message });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // POST /api/chat/stream
    // Demonstrates: Streaming Responses (Server-Sent Events)
    // ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Sends a list of chat messages and streams each token/chunk back
    /// to the caller as a Server-Sent Events (text/event-stream) response.
    ///
    /// Clients read the response incrementally. Each SSE frame has the form:
    ///   data: Hello
    ///   data:  world
    ///   data: [DONE]
    ///
    /// This allows the UI to display words as they arrive, giving a
    /// "typing" feel similar to ChatGPT.
    /// </summary>
    [HttpPost("stream")]
    public async Task StreamPost(
        [FromBody] ChatRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Messages is null || request.Messages.Count == 0)
        {
            Response.StatusCode = StatusCodes.Status400BadRequest;
            await Response.WriteAsJsonAsync(new { error = "At least one message is required." }, cancellationToken);
            return;
        }

        // Set the response content type to text/event-stream so browsers
        // and fetch clients can consume it as a Server-Sent Events stream.
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection   = "keep-alive";

        try
        {
            await foreach (var chunk in _chatService.GetReplyStreamAsync(
                request.Messages, request.Model, cancellationToken))
            {
                // Each SSE event is a "data: <payload>\n\n" line.
                await Response.WriteAsync($"data: {chunk}\n\n", cancellationToken);
                await Response.Body.FlushAsync(cancellationToken);
            }

            // Signal end-of-stream to the client.
            await Response.WriteAsync("data: [DONE]\n\n", cancellationToken);
            await Response.Body.FlushAsync(cancellationToken);
        }
        // ── Error Handling ──────────────────────────────────────────
        catch (ArgumentException ex)
        {
            await Response.WriteAsync($"data: [ERROR] {ex.Message}\n\n", cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            await Response.WriteAsync($"data: [ERROR] {ex.Message}\n\n", cancellationToken);
        }
        catch (HttpRequestException ex)
        {
            await Response.WriteAsync($"data: [ERROR] {ex.Message}\n\n", cancellationToken);
        }
        finally
        {
            await Response.Body.FlushAsync(cancellationToken);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // GET /api/chat/models
    // Demonstrates: API Integration — model discovery
    // ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Returns a list of available models from OpenRouter.
    /// The UI uses this to populate the model selector dropdown.
    /// Falls back to a curated static list if the OpenRouter models
    /// endpoint is unavailable.
    /// </summary>
    [HttpGet("models")]
    public async Task<ActionResult<IReadOnlyList<ModelInfo>>> GetModels(
        CancellationToken cancellationToken)
    {
        try
        {
            var models = await _chatService.GetAvailableModelsAsync(cancellationToken);
            return Ok(models);
        }
        catch (InvalidOperationException ex)
        {
            // Missing API key — return 500 with clear message
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = ex.Message });
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new { error = ex.Message });
        }
    }
}
