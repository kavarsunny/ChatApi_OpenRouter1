namespace ChatApi.Services;

public class OpenRouterOptions
{
    public const string SectionName = "OpenRouter";

    public string ApiKey   { get; set; } = string.Empty;
    public string Model    { get; set; } = "openai/gpt-4o-mini";

    // Optional but recommended by OpenRouter for attribution/rankings.
    public string? SiteUrl  { get; set; }
    public string? SiteName { get; set; }

    /// <summary>
    /// Path to the company knowledge base text file (relative to the app root).
    /// When set, its contents are injected as a system message at the start
    /// of every conversation so the AI knows about your company.
    /// </summary>
    public string KnowledgeFilePath { get; set; } = "company-knowledge.txt";
}
