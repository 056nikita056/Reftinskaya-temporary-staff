# Reftinskaya Temporary Staff

Новый монорепозиторий для переписываемого проекта управления временным персоналом Рефтинской птицефабрики.

Сейчас здесь оставлены только:

- `apps/web` — существующий React + Vite + Tailwind PWA-фронтенд.
- `apps/api` — новый NestJS + Prisma backend-каркас для этапа 1.
- `packages/contracts` — общие TypeScript-типы и RBAC-контракт `@reftinskaya/contracts` для будущего API.

Бэкенд переписывается поэтапно. Сейчас в `apps/api` есть авторизация, роли, фабрики, профиль пользователя, совместимый `compat` API для рабочих разделов, плановые таблицы в PostgreSQL и базовые endpoints блока 1. Фронт обращается к API через `VITE_API_BASE_URL` со значением по умолчанию `/api/v1`.

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

После миграций и seed доступен стартовый пользователь:

```text
login: admin
password: admin12345
```

Пароль можно переопределить переменной `SEED_ADMIN_PASSWORD`.

## Проверки

```bash
npm run typecheck
npm run build
npm run test
bash scripts/smoke-auth.sh
```
