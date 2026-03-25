> تمت ترجمة هذا المستند بواسطة Claude. إذا كانت لديك اقتراحات للتحسين، فإن طلبات السحب مرحب بها.

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 التوثيق</a>
  | <a href="https://stack-auth.com/">☁️ النسخة السحابية</a>
  | <a href="https://demo.stack-auth.com/">✨ عرض تجريبي</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | العربية | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: منصة المصادقة مفتوحة المصدر

Stack Auth هو حل مُدار لمصادقة المستخدمين. إنه سهل الاستخدام للمطورين ومفتوح المصدر بالكامل (مرخص بموجب MIT وAGPL).

يتيح لك Stack Auth البدء في خمس دقائق فقط، وبعدها ستكون جاهزاً لاستخدام جميع ميزاته مع نمو مشروعك. خدمتنا المُدارة اختيارية تماماً ويمكنك تصدير بيانات المستخدمين واستضافة النظام بنفسك، مجاناً، في أي وقت.

نحن ندعم واجهات Next.js وReact وJavaScript الأمامية، بالإضافة إلى أي واجهة خلفية يمكنها استخدام [REST API](https://docs.stack-auth.com/api/overview) الخاص بنا. اطلع على [دليل الإعداد](https://docs.stack-auth.com/docs/next/getting-started/setup) للبدء.

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## كيف يختلف هذا عن X؟

اسأل نفسك عن `X`:

- هل `X` مفتوح المصدر؟
- هل `X` سهل الاستخدام للمطورين، وموثق جيداً، ويتيح لك البدء في دقائق؟
- إلى جانب المصادقة، هل يوفر `X` أيضاً التفويض وإدارة المستخدمين (انظر قائمة الميزات أدناه)؟

إذا أجبت بـ "لا" على أي من هذه الأسئلة، فهذا هو ما يميز Stack Auth عن `X`.

## ✨ الميزات

للحصول على إشعارات أولاً عند إضافة ميزات جديدة، يرجى الاشتراك في [نشرتنا الإخبارية](https://stack-auth.beehiiv.com/subscribe).

| | |
|-|:-:|
| <h3>`<SignIn/>` و `<SignUp/>`</h3> مكونات المصادقة التي تدعم OAuth، وبيانات اعتماد كلمة المرور، والروابط السحرية، مع مفاتيح تطوير مشتركة لتسريع الإعداد. جميع المكونات تدعم الوضع الداكن والفاتح. | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>واجهات برمجة Next.js الاصطلاحية</h3> نبني على مكونات الخادم، وخطافات React، ومعالجات المسارات. | ![Dark/light mode](.github/assets/components.png) |
| <h3>لوحة تحكم المستخدمين</h3> لوحة تحكم لتصفية المستخدمين وتحليلهم وتعديلهم. تحل محل أول أداة داخلية كنت ستحتاج لبنائها. | ![User dashboard](.github/assets/dashboard.png) |
| <h3>إعدادات الحساب</h3> تتيح للمستخدمين تحديث ملفهم الشخصي، أو التحقق من بريدهم الإلكتروني، أو تغيير كلمة المرور. لا يلزم أي إعداد. | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>تعدد المستأجرين والفرق</h3> إدارة عملاء B2B بهيكل تنظيمي منطقي وقابل للتوسع إلى الملايين. | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>التحكم في الوصول المبني على الأدوار</h3> حدد مخطط أذونات عشوائي وعيّنه للمستخدمين. يمكن للمؤسسات إنشاء أدوار خاصة بالمؤسسة. | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>اتصالات OAuth</h3>بالإضافة إلى تسجيل الدخول، يمكن لـ Stack Auth أيضاً إدارة رموز الوصول لواجهات برمجة التطبيقات الخارجية، مثل Outlook وGoogle Calendar. يتولى تجديد الرموز والتحكم في النطاق، مما يجعل رموز الوصول متاحة عبر استدعاء دالة واحد. | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkeys</h3> دعم المصادقة بدون كلمة مرور باستخدام passkeys، مما يتيح للمستخدمين تسجيل الدخول بأمان باستخدام القياسات الحيوية أو مفاتيح الأمان عبر جميع أجهزتهم. | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>انتحال الهوية</h3> انتحل هوية المستخدمين لأغراض تصحيح الأخطاء والدعم، بتسجيل الدخول إلى حسابهم كما لو كنت أنت هم. | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhooks</h3> احصل على إشعارات عندما يستخدم المستخدمون منتجك، مبني على Svix. | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>رسائل البريد الإلكتروني التلقائية</h3> أرسل رسائل بريد إلكتروني قابلة للتخصيص عند مشغلات مثل التسجيل، وإعادة تعيين كلمة المرور، والتحقق من البريد الإلكتروني، قابلة للتحرير باستخدام محرر WYSIWYG. | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>إدارة جلسات المستخدم وJWT</h3> يدير Stack Auth رموز التجديد والوصول، وJWT، والكوكيز، مما يؤدي إلى أفضل أداء دون تكلفة تنفيذ. | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>مصادقة الآلة إلى الآلة (M2M)</h3> استخدم رموز وصول قصيرة الأجل لمصادقة أجهزتك مع أجهزة أخرى. | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 التثبيت والإعداد

لتثبيت Stack Auth في مشروع Next.js الخاص بك (لـ React أو JavaScript أو أطر العمل الأخرى، انظر [التوثيق الكامل](https://docs.stack-auth.com)):

1. قم بتشغيل معالج تثبيت Stack Auth بالأمر التالي:
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. ثم أنشئ حساباً على [لوحة تحكم Stack Auth](https://app.stack-auth.com/projects)، وأنشئ مشروعاً جديداً بمفتاح API، وانسخ متغيرات البيئة الخاصة به إلى ملف .env.local في مشروع Next.js الخاص بك:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. هذا كل شيء! يمكنك تشغيل تطبيقك بأمر `npm run dev` والذهاب إلى [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) لرؤية صفحة التسجيل. يمكنك أيضاً الاطلاع على صفحة إعدادات الحساب على [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings).

اطلع على [التوثيق](https://docs.stack-auth.com/getting-started/setup) للحصول على دليل أكثر تفصيلاً.

## 🌱 بعض مشاريع المجتمع المبنية باستخدام Stack Auth

لديك مشروع خاص بك؟ يسعدنا عرضه إذا أنشأت طلب سحب أو راسلتنا على [Discord](https://discord.stack-auth.com).

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 التطوير والمساهمة

هذا القسم لك إذا كنت ترغب في المساهمة في مشروع Stack Auth أو تشغيل لوحة تحكم Stack Auth محلياً.

**مهم**: يرجى قراءة [إرشادات المساهمة](CONTRIBUTING.md) بعناية والانضمام إلى [Discord الخاص بنا](https://discord.stack-auth.com) إذا كنت ترغب في المساعدة.

### المتطلبات

- Node v20
- pnpm v9
- Docker

### الإعداد

ملاحظة: يُوصى بذاكرة وصول عشوائي بحجم 24 جيجابايت أو أكثر لتجربة تطوير سلسة.

في نافذة طرفية جديدة:

```sh
pnpm install
pnpm build:packages
pnpm codegen
pnpm restart-deps
pnpm dev

# في نافذة طرفية أخرى، قم بتشغيل الاختبارات في وضع المراقبة
pnpm test
```

يمكنك الآن فتح صفحة التطوير على [http://localhost:8100](http://localhost:8100). من هناك، يمكنك الانتقال إلى لوحة التحكم على [http://localhost:8101](http://localhost:8101)، وAPI على المنفذ 8102، والعرض التجريبي على المنفذ 8103، والتوثيق على المنفذ 8104، وInbucket (البريد الإلكتروني) على المنفذ 8105، وPrisma Studio على المنفذ 8106. انظر صفحة التطوير لقائمة جميع الخدمات قيد التشغيل.

قد يعرض محرر الأكواد الخاص بك خطأ على جميع استيرادات `@stackframe/XYZ`. لإصلاح ذلك، ما عليك سوى إعادة تشغيل خادم لغة TypeScript؛ على سبيل المثال، في VSCode يمكنك فتح لوحة الأوامر (Ctrl+Shift+P) وتشغيل `Developer: Reload Window` أو `TypeScript: Restart TS server`.

ملفات .env المعبأة مسبقاً للإعداد أدناه متوفرة وتُستخدم افتراضياً في `.env.development` في كل حزمة. ومع ذلك، إذا كنت تنشئ بناءً إنتاجياً (مثلاً باستخدام `pnpm run build`)، يجب عليك توفير متغيرات البيئة يدوياً (انظر أدناه).

### أوامر مفيدة

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm build
pnpm build:packages
pnpm codegen
pnpm dev
pnpm dev:full
pnpm dev:basic
pnpm start-deps
pnpm stop-deps
pnpm restart-deps
pnpm db:migration-gen
pnpm db:reset
pnpm db:init
pnpm db:seed
pnpm db:migrate
pnpm test <file-filters>
pnpm explain-query
pnpm verify-data-integrity
```

ملاحظة: عند العمل مع الذكاء الاصطناعي، يجب أن تبقي علامة تبويب طرفية مفتوحة مع خادم التطوير حتى يتمكن الذكاء الاصطناعي من تنفيذ الاستعلامات ضده.

## ❤ المساهمون

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
