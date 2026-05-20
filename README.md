# Clockster Bitrix Sync

Синхронизатор еженедельно берет актуальные адреса из списка Bitrix `Адрес объекта` и приводит список локаций Clockster к такому же набору названий.

Источник в Bitrix:

- список: `115`
- поле названия локации: `NAME` (`Адрес объекта`)
- статус актуальности: `PROPERTY_1249`
- актуальный статус: `4467` (`Актуальный (Реализация)`)

Clockster API:

- base URL: `https://api.clockster.com/company/v2`
- локации: `GET/POST/PUT /locations`
- авторизация: `Authorization: Bearer {ACCESS-TOKEN}`

## Настройка

1. Установить Node.js 20+ на сервер.
2. Скопировать `.env.example` в `.env`.
3. Заполнить `BITRIX_WEBHOOK_URL` и `CLOCKSTER_TOKEN`.

```bash
cp .env.example .env
npm run bitrix:test
npm run dry-run
```

`dry-run` ничего не меняет в Clockster, только создает отчет в `logs/`.

## Проверка на одном адресе

Чтобы не менять массово Clockster, можно ограничить запуск одним или несколькими Bitrix ID:

```bash
npm run dry-run -- --only-bitrix-id=3959997
npm run sync -- --only-bitrix-id=3959997
```

Повторный `dry-run` по тому же ID должен показать `Created: 0` и `Updated: 0`.

## Реальный запуск

```bash
npm run sync
```

После успешного запуска появится файл `data/mappings.json`, где хранится связь:

```json
{
  "bitrixToClockster": {
    "3959997": 123
  }
}
```

## Расписание

Для запуска каждый понедельник в 09:00:

```cron
0 9 * * 1 cd /path/to/clockster-bitrix-sync && /usr/bin/npm run sync >> logs/cron.log 2>&1
```

Если сервер работает не в нужном часовом поясе, задайте `TZ=Asia/Qyzylorda` в окружении cron или сервера.

## Безопасность

- Не коммитить `.env`.
- Первый боевой запуск делать только после проверки `npm run dry-run`.
- Локации, которые есть только в Clockster, не удаляются автоматически. Они попадают в отчет `onlyInClockster`.
