# Shahab Radar / Green Line Scanner

اسکنر SPOT برای ۱۰۰ دارایی برتر بازار با تایم‌فریم روزانه (`1d`) و گزارش بک‌تست تاریخی.

## قوانین قطعی

- فقط بازار SPOT و فقط معاملات LONG؛ لوریج و Short وجود ندارد.
- فهرست بازارها از Market Cap دریافت و بدون استیبل‌کوین و دارایی‌های wrapped/staked تکراری ساخته می‌شود.
- فقط کندل بسته‌شده وارد موتور سیگنال می‌شود.
- Touch: `Low <= greenLine` در کندل قبلی.
- Breakout-Up: `previous Close <= previous greenLine` و `current Close > current greenLine`.
- ورود پیش‌فرض: Close کندل سیگنال.
- هر ارز در هر لحظه فقط یک معامله باز دارد.
- `TP = entry × 1.25` و `SL = entry × 0.75`.
- پایش خروج از کندل بعد از ورود شروع می‌شود؛ سایه کندل معیار لمس سطح است.
- اگر یک کندل هر دو سطح را لمس کند، داده 1h و سپس 1m برای رفع ابهام بررسی می‌شود؛ در صورت باقی‌ماندن ابهام، وضعیت `AMBIGUOUS` است.
- نتیجه معامله پس از بسته‌شدن در گزارش بازنویسی نمی‌شود.

## فرمول اندیکاتور

فرمول فعلی Green Line و Gray Zone در `src/server/engine.ts` به‌صورت causal پیاده‌سازی شده است: خط مرکزی مبتنی بر Kernel Regression و ALMA و باندها با ATR و ضریب Envelope. این محاسبه از داده آینده استفاده نمی‌کند. در صورت ارائه Pine Script رسمی، تنها همین Provider جایگزین می‌شود و قرارداد سیگنال تغییر نمی‌کند.

## ساختار اصلی

- `src/server/engine.ts`: محاسبه باندها، Touch و Breakout
- `src/server/backtest.ts`: Target/Stop، پایش خروج و گزارش مالی
- `src/server/scanner.ts`: اسکن زنده و نگهداری کش بازار
- `src/app/api/signals/timeline`: سیگنال‌ها و وضعیت Target/Stop
- `src/components/ChartPanel.tsx`: نمودار، خطوط TP/SL و مارکر نتیجه
- `src/components/SignalTimeframePanel.tsx`: اسکن ۱۰۰ ارز و ورود مستقیم به چارت

## محدودیت‌ها

داده Binance اولویت دارد و برای نمادهای فاقد جفت، منابع جایگزین طبق تنظیمات پروژه استفاده می‌شوند. بک‌تست تاریخی تضمین‌کننده سود آینده نیست. کارمزد و لغزش اجرای واقعی در گزارش جداگانه لحاظ می‌شوند.

## اجرا

```bash
npm ci
npm run typecheck
npm run build
npm run start
```

متغیر اتصال دیتابیس: `RADAR_DATABASE_URL` یا `DATABASE_URL`.
