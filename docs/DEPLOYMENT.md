# راه‌اندازی روی GitHub Pages

برنامه یک سایت استاتیک است و مستقیماً از همین ریپازیتوری روی GitHub Pages اجرا می‌شود. نه سرور لازم دارد، نه دیتابیس، نه مرحله build.

## فعال‌سازی (یک بار)

1. در گیت‌هاب به صفحه ریپازیتوری `mrasoul10-sudo/promptcreator` بروید.
2. **Settings** ← از منوی کناری **Pages**.
3. در بخش **Build and deployment**:
   - **Source**: `Deploy from a branch`
   - **Branch**: شاخه‌ای که کد در آن است (مثلاً `main` یا `claude/free-credit-usage-2bg9tp`) و پوشه `/ (root)`
   - روی **Save** بزنید.
4. یکی دو دقیقه صبر کنید. آدرس سایت بالای همان صفحه نمایش داده می‌شود:

   **https://mrasoul10-sudo.github.io/promptcreator/**

از این به بعد هر push به همان شاخه، سایت را به‌طور خودکار به‌روز می‌کند.

> ریپازیتوری باید **Public** باشد (در حساب رایگان گیت‌هاب، Pages برای ریپازیتوری خصوصی در دسترس نیست).

## ورود با گوگل (اختیاری)

دکمه «ادامه با گوگل» فقط وقتی نمایش داده می‌شود که یک **Client ID** گوگل در فایل `assets/js/config.js` قرار گرفته باشد. این شناسه عمومی است و محرمانه نیست.

1. به <https://console.cloud.google.com/> بروید و یک پروژه بسازید یا پروژه‌ای را انتخاب کنید.
2. **APIs & Services → OAuth consent screen**: نوع **External** را انتخاب کنید، نام برنامه (Prompt Creator) و ایمیل را وارد کنید و در آخر **Publish app** را بزنید.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized JavaScript origins**: `https://mrasoul10-sudo.github.io` (و برای تست محلی `http://localhost:8765`)
   - Redirect URI لازم نیست.
4. Client ID ساخته‌شده (به شکل `xxxx.apps.googleusercontent.com`) را در `assets/js/config.js` بگذارید:
   ```js
   export const GOOGLE_CLIENT_ID = 'xxxx.apps.googleusercontent.com';
   ```
5. تغییر را commit و push کنید.

## کلید API

برای ساخت پرامپت، هر کاربر باید کلید API خودش را در صفحه «تنظیمات» برنامه وارد کند:

1. به <https://console.anthropic.com> بروید و وارد شوید یا ثبت‌نام کنید.
2. از بخش **Billing** اعتبار اضافه کنید. API از اشتراک Claude Pro/Max جداست و هزینه‌اش جدا حساب می‌شود.
3. از بخش **API Keys** یک کلید بسازید و آن را در تنظیمات برنامه وارد کنید.

کلید فقط در مرورگر کاربر ذخیره می‌شود و مستقیماً به `api.anthropic.com` فرستاده می‌شود. هیچ کلیدی در ریپازیتوری قرار نمی‌گیرد.

## اجرای محلی برای توسعه

```bash
python3 -m http.server 8765
# سپس در مرورگر: http://localhost:8765/
```

باز کردن مستقیم `index.html` با `file://` کار نمی‌کند، چون ماژول‌های ES و WebCrypto به `localhost` یا HTTPS نیاز دارند.

## دامنه اختصاصی (اختیاری)

در همان صفحه Pages می‌توانید در بخش **Custom domain** دامنه خودتان را وارد کنید و گزینه **Enforce HTTPS** را روشن کنید.
