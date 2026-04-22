> Bản dịch này được tạo bởi Claude. Nếu bạn có đề xuất cải thiện, PR luôn được chào đón.

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 Tài liệu</a>
  | <a href="https://stack-auth.com/">☁️ Phiên bản Cloud</a>
  | <a href="https://demo.stack-auth.com/">✨ Demo</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | Tiếng Việt | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: Nền tảng xác thực mã nguồn mở

Stack Auth là giải pháp xác thực người dùng được quản lý. Thân thiện với nhà phát triển và hoàn toàn mã nguồn mở (được cấp phép theo MIT và AGPL).

Stack Auth giúp bạn bắt đầu chỉ trong năm phút, sau đó bạn có thể sử dụng tất cả các tính năng khi dự án phát triển. Dịch vụ quản lý của chúng tôi hoàn toàn tùy chọn và bạn có thể xuất dữ liệu người dùng và tự triển khai, miễn phí, bất cứ lúc nào.

Chúng tôi hỗ trợ giao diện Next.js, React và JavaScript, cùng với bất kỳ backend nào có thể sử dụng [REST API](https://docs.stack-auth.com/api/overview) của chúng tôi. Xem [hướng dẫn cài đặt](https://docs.stack-auth.com/docs/next/getting-started/setup) để bắt đầu.

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## Khác biệt gì so với X?

Hãy tự hỏi về `X`:

- `X` có phải mã nguồn mở không?
- `X` có thân thiện với nhà phát triển, tài liệu đầy đủ, và cho phép bạn bắt đầu trong vài phút không?
- Ngoài xác thực, `X` có hỗ trợ phân quyền và quản lý người dùng không (xem danh sách tính năng bên dưới)?

Nếu bạn trả lời "không" cho bất kỳ câu hỏi nào, đó chính là điểm khác biệt của Stack Auth so với `X`.

## ✨ Tính năng

Để nhận thông báo sớm nhất khi chúng tôi thêm tính năng mới, hãy đăng ký [bản tin của chúng tôi](https://stack-auth.beehiiv.com/subscribe).

| | |
|-|:-:|
| <h3>`<SignIn/>` và `<SignUp/>`</h3> Các component xác thực hỗ trợ OAuth, đăng nhập bằng mật khẩu và magic link, với khóa phát triển dùng chung để cài đặt nhanh hơn. Tất cả component đều hỗ trợ chế độ tối/sáng. | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>API Next.js theo phong cách tự nhiên</h3> Chúng tôi xây dựng trên server components, React hooks và route handlers. | ![Dark/light mode](.github/assets/components.png) |
| <h3>Bảng điều khiển người dùng</h3> Bảng điều khiển để lọc, phân tích và chỉnh sửa người dùng. Thay thế công cụ nội bộ đầu tiên mà bạn phải xây dựng. | ![User dashboard](.github/assets/dashboard.png) |
| <h3>Cài đặt tài khoản</h3> Cho phép người dùng cập nhật hồ sơ, xác minh email hoặc thay đổi mật khẩu. Không cần cài đặt gì thêm. | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>Đa tổ chức & nhóm</h3> Quản lý khách hàng B2B với cấu trúc tổ chức hợp lý và mở rộng được đến hàng triệu người dùng. | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>Kiểm soát truy cập theo vai trò</h3> Định nghĩa đồ thị quyền hạn tùy ý và gán cho người dùng. Tổ chức có thể tạo vai trò riêng. | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>Kết nối OAuth</h3> Ngoài đăng nhập, Stack Auth còn quản lý access token cho API bên thứ ba như Outlook và Google Calendar. Hệ thống xử lý việc làm mới token và kiểm soát phạm vi, giúp truy cập access token chỉ qua một lệnh gọi hàm duy nhất. | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkeys</h3> Hỗ trợ xác thực không cần mật khẩu bằng passkeys, cho phép người dùng đăng nhập an toàn bằng sinh trắc học hoặc khóa bảo mật trên tất cả thiết bị. | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>Mạo danh người dùng</h3> Mạo danh người dùng để gỡ lỗi và hỗ trợ, đăng nhập vào tài khoản của họ như thể bạn là họ. | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhooks</h3> Nhận thông báo khi người dùng sử dụng sản phẩm của bạn, được xây dựng trên Svix. | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>Email tự động</h3> Gửi email tùy chỉnh theo các sự kiện như đăng ký, đặt lại mật khẩu và xác minh email, có thể chỉnh sửa bằng trình soạn thảo WYSIWYG. | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>Quản lý phiên người dùng & JWT</h3> Stack Auth quản lý refresh token, access token, JWT và cookie, mang lại hiệu suất tốt nhất mà không tốn chi phí triển khai. | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>Xác thực M2M</h3> Sử dụng access token ngắn hạn để xác thực máy với máy. | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 Cài đặt & Thiết lập

Để cài đặt Stack Auth trong dự án Next.js của bạn (đối với React, JavaScript hoặc các framework khác, xem [tài liệu đầy đủ](https://docs.stack-auth.com)):

1. Chạy trình hướng dẫn cài đặt của Stack Auth bằng lệnh sau:
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. Sau đó, tạo tài khoản trên [bảng điều khiển Stack Auth](https://app.stack-auth.com/projects), tạo dự án mới với API key, và sao chép các biến môi trường vào file .env.local của dự án Next.js:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. Vậy là xong! Bạn có thể chạy ứng dụng với `npm run dev` và truy cập [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) để xem trang đăng ký. Bạn cũng có thể xem trang cài đặt tài khoản tại [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings).

Xem [tài liệu](https://docs.stack-auth.com/getting-started/setup) để biết hướng dẫn chi tiết hơn.

## 🌱 Một số dự án cộng đồng được xây dựng với Stack Auth

Bạn có dự án riêng? Chúng tôi rất vui được giới thiệu nếu bạn tạo PR hoặc nhắn cho chúng tôi trên [Discord](https://discord.stack-auth.com).

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 Phát triển & Đóng góp

Phần này dành cho bạn nếu bạn muốn đóng góp cho dự án Stack Auth hoặc chạy bảng điều khiển Stack Auth trên máy cục bộ.

**Quan trọng**: Vui lòng đọc [hướng dẫn đóng góp](CONTRIBUTING.md) cẩn thận và tham gia [Discord của chúng tôi](https://discord.stack-auth.com) nếu bạn muốn giúp đỡ.

### Yêu cầu

- Node v20
- pnpm v9
- Docker

### Thiết lập

Lưu ý: Khuyến nghị RAM 24GB trở lên để có trải nghiệm phát triển mượt mà.

Trong terminal mới:

```sh
pnpm install
pnpm build:packages
pnpm codegen
pnpm restart-deps
pnpm dev

# Trong terminal khác, chạy test ở chế độ theo dõi
pnpm test
```

Bây giờ bạn có thể mở trang khởi động phát triển tại [http://localhost:8100](http://localhost:8100). Từ đó, bạn có thể truy cập bảng điều khiển tại [http://localhost:8101](http://localhost:8101), API trên cổng 8102, demo trên cổng 8103, tài liệu trên cổng 8104, Inbucket (email) trên cổng 8105, và Prisma Studio trên cổng 8106. Xem trang khởi động phát triển để biết danh sách tất cả các dịch vụ đang chạy.

IDE của bạn có thể hiển thị lỗi trên tất cả import `@stackframe/XYZ`. Để khắc phục, chỉ cần khởi động lại TypeScript language server; ví dụ, trong VSCode bạn có thể mở command palette (Ctrl+Shift+P) và chạy `Developer: Reload Window` hoặc `TypeScript: Restart TS server`.

Các file .env được điền sẵn cho cài đặt bên dưới có sẵn và được sử dụng mặc định trong `.env.development` ở mỗi package. Tuy nhiên, nếu bạn tạo bản build production (ví dụ với `pnpm run build`), bạn phải cung cấp các biến môi trường thủ công (xem bên dưới).

### Các lệnh hữu ích

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

Lưu ý: Khi làm việc với AI, bạn nên mở sẵn một tab terminal với dev server để AI có thể chạy truy vấn.

## ❤ Người đóng góp

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
