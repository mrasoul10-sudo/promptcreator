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

## سرویس رایگان ساخت پرامپت (Gemini روی Cloudflare)

با این سرویس، کاربران **بدون کلید و بدون هزینه** پرامپت می‌سازند. کلید Gemini شما فقط روی سرور Cloudflare نگه داشته می‌شود و کسی آن را نمی‌بیند. هر بازدیدکننده روزانه تعداد محدودی پرامپت رایگان دارد (پیش‌فرض ۲۰، کل سایت ۹۰۰ و حداکثر ۸ درخواست در دقیقه). این اعداد در `worker/wrangler.toml` تغییر می‌کنند.

### یک بار انجام دهید
1. **کلید Gemini**: به <https://aistudio.google.com/apikey> بروید، با حساب گوگل وارد شوید و **Create API key** را بزنید. کارت بانکی لازم نیست.
2. **حساب Cloudflare**: در <https://dash.cloudflare.com/sign-up> یک حساب رایگان بسازید، سپس یک بار وارد بخش **Workers & Pages** شوید تا زیردامنه `workers.dev` شما ساخته شود.
3. **Account ID**: در صفحه **Workers & Pages** (یا Overview حساب)، مقدار **Account ID** را کپی کنید.
4. **API Token**: به **My Profile → API Tokens → Create Token** بروید، قالب **Edit Cloudflare Workers** را انتخاب کنید و **Continue to summary → Create Token** را بزنید. توکن را کپی کنید.
5. در گیت‌هاب به **Settings → Secrets and variables → Actions → New repository secret** بروید و این سه Secret را بسازید:

   | Name | Value |
   |---|---|
   | `GEMINI_API_KEY` | کلید مرحله ۱ |
   | `CLOUDFLARE_ACCOUNT_ID` | مقدار مرحله ۳ |
   | `CLOUDFLARE_API_TOKEN` | توکن مرحله ۴ |

6. در تب **Actions** ریپازیتوری، workflow با نام **Deploy free API (Cloudflare Worker)** را انتخاب کنید و **Run workflow** را بزنید.

این workflow سرور را تست و منتشر می‌کند و آدرس آن را خودکار در `assets/js/config.js` قرار می‌دهد. چند دقیقه بعد سایت از سرویس رایگان استفاده می‌کند.

> نکته: در سطح رایگان، گوگل ممکن است از متن درخواست‌ها برای بهبود مدل‌هایش استفاده کند و سقف روزانه درخواست‌ها را هر از گاهی تغییر دهد.

## کلید API Claude (اختیاری)

اگر کاربری بخواهد به‌جای سرویس رایگان از Claude استفاده کند، در «تنظیمات» گزینه «Claude با کلید شخصی» را انتخاب می‌کند و کلید خودش را وارد می‌کند:

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
