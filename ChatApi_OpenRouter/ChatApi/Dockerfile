# Use the official .NET 10 SDK image to build the app
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /app

# Copy csproj and restore dependencies
COPY ["ChatApi.csproj", "./"]
RUN dotnet restore "./ChatApi.csproj"

# Copy everything else and build the release package
COPY . .
RUN dotnet publish "ChatApi.csproj" -c Release -o /app/publish /p:UseAppHost=false

# Use the lighter ASP.NET runtime image for production
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

# Render dynamically assigns a port via the PORT environment variable.
# We configure ASP.NET Core to listen on this port.
ENV PORT=8080
ENV ASPNETCORE_URLS=http://+:${PORT}

ENTRYPOINT ["dotnet", "ChatApi.dll"]
