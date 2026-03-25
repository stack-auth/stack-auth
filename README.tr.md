> Bu çeviri Claude tarafından oluşturulmuştur. İyileştirme önerileriniz varsa PR'lar memnuniyetle karşılanır.

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 Dokümantasyon</a>
  | <a href="https://stack-auth.com/">☁️ Bulut Sürümü</a>
  | <a href="https://demo.stack-auth.com/">✨ Demo</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | Türkçe | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: Açık kaynaklı kimlik doğrulama platformu

Stack Auth, yönetilen bir kullanıcı kimlik doğrulama çözümüdür. Geliştirici dostudur ve tamamen açık kaynaktır (MIT ve AGPL lisansları altında).

Stack Auth ile sadece beş dakikada başlayabilirsiniz, ardından projeniz büyüdükçe tüm özelliklerini kullanmaya hazır olursunuz. Yönetilen hizmetimiz tamamen isteğe bağlıdır ve kullanıcı verilerinizi dışa aktararak istediğiniz zaman ücretsiz olarak kendi sunucunuzda barındırabilirsiniz.

Next.js, React ve JavaScript ön yüzlerini, ayrıca [REST API](https://docs.stack-auth.com/api/overview)'mizi kullanabilen herhangi bir arka ucu destekliyoruz. Başlamak için [kurulum kılavuzumuza](https://docs.stack-auth.com/docs/next/getting-started/setup) göz atın.

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## Bu X'ten nasıl farklı?

Kendinize `X` hakkında şunu sorun:

- `X` açık kaynaklı mı?
- `X` geliştirici dostu mu, iyi belgelenmiş mi ve dakikalar içinde başlamanızı sağlıyor mu?
- Kimlik doğrulamanın yanı sıra, `X` yetkilendirme ve kullanıcı yönetimi de yapıyor mu (aşağıdaki özellik listesine bakın)?

Bu sorulardan herhangi birine "hayır" cevabı verdiyseniz, Stack Auth'un `X`'ten farkı işte budur.

## ✨ Özellikler

Yeni özellikler eklediğimizde ilk haberdar olmak için lütfen [bültenimize](https://stack-auth.beehiiv.com/subscribe) abone olun.

| | |
|-|:-:|
| <h3>`<SignIn/>` ve `<SignUp/>`</h3> OAuth, parola kimlik bilgileri ve sihirli bağlantıları destekleyen, kurulumu hızlandırmak için paylaşımlı geliştirme anahtarlarına sahip kimlik doğrulama bileşenleri. Tüm bileşenler koyu/açık mod desteğine sahiptir. | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>Deyimsel Next.js API'leri</h3> Sunucu bileşenleri, React hooks ve rota işleyicileri üzerine inşa ediyoruz. | ![Dark/light mode](.github/assets/components.png) |
| <h3>Kullanıcı kontrol paneli</h3> Kullanıcıları filtrelemek, analiz etmek ve düzenlemek için kontrol paneli. Oluşturmanız gereken ilk dahili aracın yerini alır. | ![User dashboard](.github/assets/dashboard.png) |
| <h3>Hesap ayarları</h3> Kullanıcıların profillerini güncellemelerine, e-postalarını doğrulamalarına veya parolalarını değiştirmelerine olanak tanır. Kurulum gerektirmez. | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>Çok kiracılılık ve takımlar</h3> B2B müşterilerini mantıklı ve milyonlara ölçeklenebilen bir organizasyon yapısıyla yönetin. | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>Rol tabanlı erişim kontrolü</h3> İsteğe bağlı bir izin grafiği tanımlayın ve kullanıcılara atayın. Organizasyonlar, organizasyona özel roller oluşturabilir. | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>OAuth Bağlantıları</h3>Giriş yapmanın ötesinde, Stack Auth ayrıca Outlook ve Google Calendar gibi üçüncü taraf API'ler için erişim tokenlarını yönetebilir. Token yenileme ve kapsam kontrolünü yönetir, erişim tokenlarını tek bir fonksiyon çağrısıyla erişilebilir hale getirir. | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkeys</h3> Passkey'lerle parolasız kimlik doğrulama desteği, kullanıcıların tüm cihazlarında biyometri veya güvenlik anahtarlarıyla güvenli bir şekilde giriş yapmasını sağlar. | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>Kimliğe bürünme</h3> Hata ayıklama ve destek için kullanıcıların kimliğine bürünün, onların hesabına sanki siz onlarmışsınız gibi giriş yapın. | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhooks</h3> Kullanıcılar ürününüzü kullandığında bildirim alın, Svix üzerine inşa edilmiştir. | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>Otomatik e-postalar</h3> Kayıt, parola sıfırlama ve e-posta doğrulama gibi tetikleyicilerde özelleştirilebilir e-postalar gönderin, WYSIWYG editörüyle düzenlenebilir. | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>Kullanıcı oturumu ve JWT yönetimi</h3> Stack Auth yenileme ve erişim tokenlarını, JWT'leri ve çerezleri yönetir, uygulama maliyeti olmadan en iyi performansı sağlar. | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>M2M kimlik doğrulama</h3> Makinelerinizi diğer makinelere doğrulamak için kısa ömürlü erişim tokenları kullanın. | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 Kurulum ve Ayarlar

Stack Auth'u Next.js projenize kurmak için (React, JavaScript veya diğer çerçeveler için [eksiksiz dokümantasyonumuza](https://docs.stack-auth.com) bakın):

1. Aşağıdaki komutla Stack Auth'un kurulum sihirbazını çalıştırın:
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. Ardından [Stack Auth kontrol panelinde](https://app.stack-auth.com/projects) bir hesap oluşturun, bir API anahtarıyla yeni bir proje oluşturun ve ortam değişkenlerini Next.js projenizin .env.local dosyasına kopyalayın:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. Hepsi bu kadar! Uygulamanızı `npm run dev` ile çalıştırabilir ve kayıt sayfasını görmek için [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) adresine gidebilirsiniz. Ayrıca hesap ayarları sayfasını [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings) adresinde kontrol edebilirsiniz.

Daha ayrıntılı bir kılavuz için [dokümantasyona](https://docs.stack-auth.com/getting-started/setup) göz atın.

## 🌱 Stack Auth ile oluşturulmuş bazı topluluk projeleri

Kendinize ait bir projeniz mi var? Bir PR oluşturursanız veya [Discord](https://discord.stack-auth.com)'da bize mesaj atarsanız onu öne çıkarmaktan mutluluk duyarız.

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 Geliştirme ve Katkı

Bu bölüm, Stack Auth projesine katkıda bulunmak veya Stack Auth kontrol panelini yerel olarak çalıştırmak isteyenler içindir.

**Önemli**: Lütfen [katkı yönergelerini](CONTRIBUTING.md) dikkatlice okuyun ve yardım etmek istiyorsanız [Discord'umuza](https://discord.stack-auth.com) katılın.

### Gereksinimler

- Node v20
- pnpm v9
- Docker

### Kurulum

Not: Sorunsuz bir geliştirme deneyimi için 24 GB+ RAM önerilir.

Yeni bir terminalde:

```sh
pnpm install
pnpm build:packages
pnpm codegen
pnpm restart-deps
pnpm dev

# Farklı bir terminalde, testleri izleme modunda çalıştırın
pnpm test
```

Artık geliştirici başlatma panelini [http://localhost:8100](http://localhost:8100) adresinde açabilirsiniz. Oradan kontrol paneline [http://localhost:8101](http://localhost:8101) adresinden, API'ye port 8102'den, demoya port 8103'ten, dokümantasyona port 8104'ten, Inbucket'a (e-postalar) port 8105'ten ve Prisma Studio'ya port 8106'dan erişebilirsiniz. Çalışan tüm hizmetlerin listesi için geliştirici başlatma paneline bakın.

IDE'niz tüm `@stackframe/XYZ` içe aktarımlarında hata gösterebilir. Bunu düzeltmek için TypeScript dil sunucusunu yeniden başlatmanız yeterlidir; örneğin VSCode'da komut paletini (Ctrl+Shift+P) açıp `Developer: Reload Window` veya `TypeScript: Restart TS server` komutunu çalıştırabilirsiniz.

Aşağıdaki kurulum için önceden doldurulmuş .env dosyaları mevcut olup paketlerin her birinde `.env.development` içinde varsayılan olarak kullanılır. Ancak bir üretim derlemesi oluşturuyorsanız (örn. `pnpm run build` ile), ortam değişkenlerini manuel olarak sağlamanız gerekir (aşağıya bakın).

### Faydalı komutlar

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

Not: Yapay zeka ile çalışırken, yapay zekanın sorgular çalıştırabilmesi için geliştirme sunucusunun açık olduğu bir terminal sekmesi tutmalısınız.

## ❤ Katkıda Bulunanlar

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
