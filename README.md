# Reftinskaya Temporary Staff

Новый монорепозиторий для переписываемого проекта управления временным персоналом Рефтинской птицефабрики.

Сейчас здесь оставлены только:

- `apps/web` — существующий React + Vite + Tailwind PWA-фронтенд.
- `apps/api` — новый NestJS + Prisma backend-каркас для этапа 1.
- `packages/contracts` — общие TypeScript-типы и RBAC-контракт `@reftinskaya/contracts` для будущего API.

Бэкенд переписывается поэтапно. На текущем шаге в `apps/api` есть каркас, health-роут, Prisma-схема, первая миграция и сид ролей; эндпоинты входа будут добавлены позже. Фронт продолжает обращаться к API через `VITE_API_BASE_URL` со значением по умолчанию `/api/v1`.

## Быстрый запуск

```bash
npm install
npm run prisma:generate
npm run prisma:migrate:dev
npm run seed
npm run dev
```

- API: `http://localhost:8096/api/v1/health`
- Фронт: `http://localhost:8095`

Для локальной базы можно поднять PostgreSQL из `docker-compose.yml`.

## Проверки

```bash
npm run typecheck
npm run build
npm run test
```
