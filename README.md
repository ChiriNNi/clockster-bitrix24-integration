# Clockster Bitrix Sync

Синхронизатор локаций Clockster с актуальными сделками Bitrix CRM из воронки реализации.

## Главная логика

Источник истины: Bitrix CRM, сделки воронки `69`.

Правила связи:

```text
Clockster location.description = Bitrix deal.ID
Clockster location.title = Bitrix deal.TITLE
Clockster location.latitude = Bitrix deal.UF_CRM_1732276400585
Clockster location.longitude = Bitrix deal.UF_CRM_1732276407859
```

Поле `Адрес объекта` не используется как источник истины. Геокодинг через 2ГИС/Google не нужен для основной логики, потому что координаты уже есть в Bitrix.

## Безопасность

- Скрипт ничего не удаляет из Clockster.
- По умолчанию `npm run audit:deals` работает в dry-run и только пишет отчет.
- Новые локации создаются только при явном запуске `--sync --create`.
- Если найдены похожие локации без `description`, скрипт не создает дубль автоматически, а отправляет сделку в ручную проверку.
- Если в Clockster несколько локаций с одним `description`, скрипт не выбирает сам, а отправляет в ручную проверку.

## Настройка

1. Установить Node.js 20+.
2. Скопировать `.env.example` в `.env`.
3. Заполнить `BITRIX_WEBHOOK_URL` и `CLOCKSTER_TOKEN`.

```bash
cp .env.example .env
npm install
```

Ключевые настройки:

```text
BITRIX_DEAL_CATEGORY_ID=69
BITRIX_DEAL_LOCATION_TITLE_FIELD=TITLE
BITRIX_DEAL_LATITUDE_FIELD=UF_CRM_1732276400585
BITRIX_DEAL_LONGITUDE_FIELD=UF_CRM_1732276407859
BITRIX_DEAL_LATITUDE_MIN=40
BITRIX_DEAL_LATITUDE_MAX=56.5
BITRIX_DEAL_LONGITUDE_MIN=46
BITRIX_DEAL_LONGITUDE_MAX=88.5
DEFAULT_LOCATION_RADIUS=100
LOCATION_UPDATE_DISTANCE_METERS=50
DEAL_SYNC_CREATE_ENABLED=false
```

`LOCATION_UPDATE_DISTANCE_METERS` задает порог отличия координат. Если точка Clockster отличается от Bitrix больше чем на это расстояние, скрипт планирует обновление координат.

Диапазоны `BITRIX_DEAL_*_MIN/MAX` защищают от мусорных координат вроде `0,0`. По умолчанию выставлен примерный диапазон Казахстана.

## Проверка

Полный аудит без изменений:

```bash
npm run audit:deals
```

Проверка одной сделки:

```bash
npm run audit:deals -- --deal-id=556365
```

После запуска отчеты появляются в `logs/`:

```text
deal-sync-*.json
deal-sync-*.csv
deal-sync-*.html
```

## Действия в отчете

```text
ok_existing_link
```

Локация уже связана по `description`, название и координаты совпадают в пределах порога.

```text
update_existing_title
```

Локация связана, координаты нормальные, но название отличается от `TITLE` сделки.

```text
update_existing_coordinates
```

Локация связана, название совпадает, но координаты отличаются от Bitrix больше порога.

```text
update_existing_location
```

Локация связана, но надо обновить и название, и координаты.

```text
link_exact_title
```

В Clockster уже есть локация с точным названием, но без `description`. Скрипт может привязать ее к сделке и поставить координаты из Bitrix.

```text
review_possible_existing_location
```

Нашлись похожие локации. Автоматически не трогаем, чтобы не создать дубль и не привязать не туда.

```text
create_location
```

Похожих локаций нет, координаты Bitrix валидны, можно создать новую локацию.

```text
review_duplicate_clockster_description
```

В Clockster несколько локаций с одним `description`. Нужно ручное решение.

```text
review_missing_bitrix_coordinates
```

У сделки нет валидных координат. Создавать нельзя.

## Реальный запуск

Обновить и привязать существующие локации, но не создавать новые:

```bash
npm run sync:deals -- --sync
```

Создать новые локации тоже:

```bash
npm run sync:deals -- --sync --create
```

Ограничить количество реальных действий:

```bash
npm run sync:deals -- --sync --limit=10
```

Запустить одну сделку:

```bash
npm run sync:deals -- --deal-id=556365 --sync
```

## Расписание

Пример cron для запуска каждый понедельник в 09:00:

```cron
TZ=Asia/Qyzylorda
0 9 * * 1 cd /path/to/clockster-bitrix-sync && /usr/bin/npm run sync:deals -- --sync --create >> logs/cron.log 2>&1
```

Перед включением cron обязательно прогнать:

```bash
npm run audit:deals
```
