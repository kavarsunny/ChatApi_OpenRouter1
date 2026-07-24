using Microsoft.Extensions.Options;

namespace ChatApi.Services;

/// <summary>
/// Manages the company knowledge base file.
/// The knowledge base is injected as a system prompt into every AI conversation
/// so the model knows about your office layout, teams, facilities, and policies.
/// </summary>
public interface IKnowledgeService
{
    /// <summary>Returns the current knowledge base content (the system prompt text).</summary>
    Task<string> GetKnowledgeAsync(CancellationToken ct = default);

    /// <summary>Replaces the entire knowledge base with new content.</summary>
    Task UpdateKnowledgeAsync(string content, CancellationToken ct = default);

    /// <summary>Returns true when a non-empty knowledge base is configured.</summary>
    Task<bool> HasKnowledgeAsync(CancellationToken ct = default);
}

public class KnowledgeService : IKnowledgeService
{
    private readonly string _filePath;

    // Simple in-memory cache to avoid repeated file reads per request
    private string? _cache;
    private DateTime _cacheTime = DateTime.MinValue;
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(30);

    public KnowledgeService(IOptions<OpenRouterOptions> options, IWebHostEnvironment env)
    {
        var relativePath = options.Value.KnowledgeFilePath;
        _filePath = Path.IsPathRooted(relativePath)
            ? relativePath
            : Path.Combine(env.ContentRootPath, relativePath);
    }

    public async Task<string> GetKnowledgeAsync(CancellationToken ct = default)
    {
        // Return cached value if fresh
        if (_cache is not null && DateTime.UtcNow - _cacheTime < CacheTtl)
            return _cache;

        if (!File.Exists(_filePath))
        {
            _cache = string.Empty;
            _cacheTime = DateTime.UtcNow;
            return string.Empty;
        }

        _cache     = await File.ReadAllTextAsync(_filePath, ct);
        _cacheTime = DateTime.UtcNow;
        return _cache;
    }

    public async Task UpdateKnowledgeAsync(string content, CancellationToken ct = default)
    {
        // Ensure directory exists
        var dir = Path.GetDirectoryName(_filePath);
        if (!string.IsNullOrWhiteSpace(dir))
            Directory.CreateDirectory(dir);

        await File.WriteAllTextAsync(_filePath, content, ct);

        // Invalidate cache
        _cache     = content;
        _cacheTime = DateTime.UtcNow;
    }

    public async Task<bool> HasKnowledgeAsync(CancellationToken ct = default)
    {
        var content = await GetKnowledgeAsync(ct);
        return !string.IsNullOrWhiteSpace(content);
    }
}
