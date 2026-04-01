# Website

This website is built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

## Installation

```bash
yarn
```

## Local Development

```bash
yarn start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

## Build

```bash
yarn build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

## Deployment

Using SSH:

```bash
USE_SSH=true yarn deploy
```

Not using SSH:

```bash
GIT_USER=<Your GitHub username> yarn deploy
```

If you are using GitHub pages for hosting, this command is a convenient way to build the website and push to the `gh-pages` branch.

## Docs API Server

Il progetto include anche un server API Express per la gestione delle pagine roadmap.

### Endpoint principali

- `GET /api/docs/health`
- `GET /api/docs/roadmap/titles`
- `POST /api/docs/roadmap`
- `PUT /api/docs/roadmap/:slug/paragraphs`
- `GET /api/docs/roadmap/:slug/paragraphs`
- `PUT /api/docs/roadmap/:slug/paragraphs/:number`
- `DELETE /api/docs/roadmap/:slug`
- `DELETE /api/docs/roadmap/:slug/paragraphs/:number`
- `POST /api/docs/rebuild`
- `POST /api/docs/push`

### Comportamento build e persistenza

Le API di modifica (`POST`, `PUT`, `DELETE`) non eseguono automaticamente ne build ne push Git.

Flusso operativo corretto:

1. Modifica documentazione via API CRUD
2. `POST /api/docs/rebuild` per eseguire solo la build Docusaurus
3. `POST /api/docs/push` per eseguire solo commit e push Git
