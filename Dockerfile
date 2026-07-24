# Use the official .NET 10 SDK image to build the app
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /app

# Copy csproj and restore dependencies
COPY ["ChatApi_OpenRouter/ChatApi/ChatApi.csproj", "ChatApi/"]
RUN dotnet restore "ChatApi/ChatApi.csproj"

# Copy the rest of the backend files and build
COPY ChatApi_OpenRouter/ChatApi/ ChatApi/
WORKDIR /app/ChatApi
RUN dotnet publish "ChatApi.csproj" -c Release -o /app/publish /p:UseAppHost=false

# Use the lighter ASP.NET runtime image for production
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

# Render dynamically assigns a port via the PORT environment variable.
# We configure ASP.NET Core to listen on this port.
ENV PORT=8080
ENV ASPNETCORE_URLS=http://+:${PORT}

# Fix for Render inotify (FileSystemWatcher) limit crash
ENV DOTNET_USE_POLLING_FILE_WATCHER=true

ENTRYPOINT ["dotnet", "ChatApi.dll"]
