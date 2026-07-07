# Reftinskaya Temporary Staff

Новый монорепозиторий для переписываемого проекта управления временным персоналом Рефтинской птицефабрики.

Сейчас здесь оставлены только:

- `apps/web` — существующий React + Vite + Tailwind PWA-фронтенд.
- `packages/contracts` — общие TypeScript-типы и RBAC-контракт `@reftinskaya/contracts` для будущего API.

Бэкенд переписывается отдельно. `apps/api` будет добавлен следующим шагом, поэтому фронт пока продолжает обращаться к API через `VITE_API_BASE_URL` со значением по умолчанию `/api/v1`.

## Запуск фронта

```bash
npm install
npm run dev
```

Фронт стартует на `http://localhost:8095`.

## Проверки

```bash
npm run typecheck
npm run build
npm run test
```
