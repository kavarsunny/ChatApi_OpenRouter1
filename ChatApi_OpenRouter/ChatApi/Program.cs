using ChatApi.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<OpenRouterOptions>(
    builder.Configuration.GetSection(OpenRouterOptions.SectionName));

builder.Services.AddSingleton<IKnowledgeService, KnowledgeService>();
builder.Services.AddHttpClient<IOpenRouterChatService, OpenRouterChatService>();

builder.Services.AddControllers();
builder.Services.AddOpenApi();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AngularApp", policy =>
    {
        policy.WithOrigins("http://localhost:4200")
            .SetIsOriginAllowed(origin => 
                new Uri(origin).Host == "localhost" || 
                new Uri(origin).Host.EndsWith(".vercel.app") ||
                new Uri(origin).Host.EndsWith(".netlify.app"))
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("AngularApp");

app.UseAuthorization();
app.MapControllers();

app.Run();
