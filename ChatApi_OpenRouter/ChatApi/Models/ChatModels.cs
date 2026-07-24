namespace ChatApi.Models;

public record ChatMessage(string Role, string Content);

/// <summary>
/// Request body for both non-streaming and streaming chat endpoints.
/// The optional Model field lets the client override the default model
/// configured in appsettings.json.
/// </summary>
public record ChatRequest(
    IReadOnlyList<ChatMessage> Messages,
    string? Model = null);

public record ChatResponse(string Reply);

/// <summary>
/// Represents a single model available on OpenRouter.
/// Returned by GET /api/chat/models.
/// </summary>
public record ModelInfo(string Id, string Name, string? Description = null);
