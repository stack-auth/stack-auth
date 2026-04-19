> การแปลนี้สร้างโดย Claude หากคุณมีข้อเสนอแนะในการปรับปรุง ยินดีรับ PR

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 เอกสาร</a>
  | <a href="https://stack-auth.com/">☁️ เวอร์ชันคลาวด์</a>
  | <a href="https://demo.stack-auth.com/">✨ สาธิต</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | ไทย | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: แพลตฟอร์มยืนยันตัวตนแบบโอเพนซอร์ส

Stack Auth เป็นโซลูชันการยืนยันตัวตนผู้ใช้แบบจัดการ เป็นมิตรกับนักพัฒนาและเปิดเผยซอร์สโค้ดทั้งหมด (ลิขสิทธิ์ภายใต้ MIT และ AGPL)

Stack Auth ช่วยให้คุณเริ่มต้นได้ภายในเพียงห้านาที หลังจากนั้นคุณจะพร้อมใช้ฟีเจอร์ทั้งหมดในขณะที่โปรเจกต์ของคุณเติบโต บริการจัดการของเราเป็นทางเลือกอย่างสมบูรณ์ และคุณสามารถส่งออกข้อมูลผู้ใช้และโฮสต์เองได้ฟรีตลอดเวลา

เรารองรับ Next.js, React และ JavaScript สำหรับฝั่งหน้าบ้าน รวมถึงแบ็กเอนด์ใดก็ได้ที่สามารถใช้ [REST API](https://docs.stack-auth.com/api/overview) ของเรา ดู[คู่มือการตั้งค่า](https://docs.stack-auth.com/docs/next/getting-started/setup)ของเราเพื่อเริ่มต้นใช้งาน

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## สิ่งนี้แตกต่างจาก X อย่างไร?

ลองถามตัวเองเกี่ยวกับ `X`:

- `X` เป็นโอเพนซอร์สหรือไม่?
- `X` เป็นมิตรกับนักพัฒนา มีเอกสารครบถ้วน และให้คุณเริ่มต้นได้ภายในไม่กี่นาทีหรือไม่?
- นอกจากการยืนยันตัวตนแล้ว `X` ยังทำการอนุญาตและการจัดการผู้ใช้ด้วยหรือไม่ (ดูรายการฟีเจอร์ด้านล่าง)?

หากคุณตอบ "ไม่" กับข้อใดข้อหนึ่ง นั่นคือความแตกต่างระหว่าง Stack Auth กับ `X`

## ✨ ฟีเจอร์

หากต้องการรับการแจ้งเตือนเป็นคนแรกเมื่อเราเพิ่มฟีเจอร์ใหม่ กรุณาสมัครรับ[จดหมายข่าวของเรา](https://stack-auth.beehiiv.com/subscribe)

| | |
|-|:-:|
| <h3>`<SignIn/>` และ `<SignUp/>`</h3> คอมโพเนนต์ยืนยันตัวตนที่รองรับ OAuth, ข้อมูลรับรองแบบรหัสผ่าน และลิงก์มายากล พร้อมคีย์พัฒนาร่วมเพื่อให้ตั้งค่าได้เร็วขึ้น คอมโพเนนต์ทั้งหมดรองรับโหมดมืด/สว่าง | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>API แบบ Next.js ที่เป็นธรรมชาติ</h3> เราสร้างบนเซิร์ฟเวอร์คอมโพเนนต์, React hooks และ route handlers | ![Dark/light mode](.github/assets/components.png) |
| <h3>แดชบอร์ดผู้ใช้</h3> แดชบอร์ดสำหรับกรอง วิเคราะห์ และแก้ไขผู้ใช้ ทดแทนเครื่องมือภายในชิ้นแรกที่คุณต้องสร้าง | ![User dashboard](.github/assets/dashboard.png) |
| <h3>การตั้งค่าบัญชี</h3> ให้ผู้ใช้อัปเดตโปรไฟล์ ยืนยันอีเมล หรือเปลี่ยนรหัสผ่าน ไม่ต้องตั้งค่าใดๆ | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>การรองรับหลายผู้เช่าและทีม</h3> จัดการลูกค้า B2B ด้วยโครงสร้างองค์กรที่เข้าใจง่ายและรองรับได้ถึงหลายล้าน | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>การควบคุมการเข้าถึงตามบทบาท</h3> กำหนดกราฟสิทธิ์ตามต้องการและกำหนดให้กับผู้ใช้ องค์กรสามารถสร้างบทบาทเฉพาะขององค์กรได้ | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>การเชื่อมต่อ OAuth</h3>นอกเหนือจากการเข้าสู่ระบบ Stack Auth ยังสามารถจัดการโทเค็นการเข้าถึงสำหรับ API ของบุคคลที่สาม เช่น Outlook และ Google Calendar ระบบจัดการการรีเฟรชโทเค็นและการควบคุมขอบเขต ทำให้โทเค็นการเข้าถึงเรียกใช้ได้ผ่านฟังก์ชันเดียว | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkeys</h3> รองรับการยืนยันตัวตนแบบไม่ใช้รหัสผ่านด้วย passkeys ช่วยให้ผู้ใช้เข้าสู่ระบบได้อย่างปลอดภัยด้วยไบโอเมตริกซ์หรือคีย์ความปลอดภัยบนอุปกรณ์ทุกเครื่อง | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>การแอบอ้างเป็นผู้ใช้</h3> แอบอ้างเป็นผู้ใช้เพื่อการดีบักและสนับสนุน โดยเข้าสู่ระบบในบัญชีของพวกเขาเสมือนเป็นตัวพวกเขาเอง | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhooks</h3> รับการแจ้งเตือนเมื่อผู้ใช้ใช้งานผลิตภัณฑ์ของคุณ สร้างบน Svix | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>อีเมลอัตโนมัติ</h3> ส่งอีเมลที่ปรับแต่งได้เมื่อเกิดเหตุการณ์ เช่น การลงทะเบียน การรีเซ็ตรหัสผ่าน และการยืนยันอีเมล แก้ไขได้ด้วยตัวแก้ไข WYSIWYG | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>การจัดการเซสชันผู้ใช้และ JWT</h3> Stack Auth จัดการ refresh token, access token, JWT และคุกกี้ ให้ประสิทธิภาพสูงสุดโดยไม่ต้องลงทุนในการพัฒนา | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>การยืนยันตัวตนแบบ M2M</h3> ใช้ access token ที่มีอายุสั้นเพื่อยืนยันตัวตนเครื่องของคุณกับเครื่องอื่น | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 การติดตั้งและตั้งค่า

หากต้องการติดตั้ง Stack Auth ในโปรเจกต์ Next.js ของคุณ (สำหรับ React, JavaScript หรือเฟรมเวิร์กอื่นๆ ดู[เอกสารฉบับสมบูรณ์](https://docs.stack-auth.com)ของเรา):

1. รันตัวช่วยติดตั้งของ Stack Auth ด้วยคำสั่งต่อไปนี้:
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. จากนั้น สร้างบัญชีบน[แดชบอร์ด Stack Auth](https://app.stack-auth.com/projects) สร้างโปรเจกต์ใหม่พร้อมคีย์ API และคัดลอกตัวแปรสภาพแวดล้อมลงในไฟล์ .env.local ของโปรเจกต์ Next.js ของคุณ:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. เท่านั้นเอง! คุณสามารถรันแอปด้วย `npm run dev` และไปที่ [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) เพื่อดูหน้าลงทะเบียน คุณยังสามารถดูหน้าการตั้งค่าบัญชีได้ที่ [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings)

ดู[เอกสาร](https://docs.stack-auth.com/getting-started/setup)สำหรับคู่มือที่ละเอียดยิ่งขึ้น

## 🌱 โปรเจกต์จากชุมชนที่สร้างด้วย Stack Auth

มีโปรเจกต์ของคุณเอง? ยินดีที่จะนำเสนอหากคุณสร้าง PR หรือส่งข้อความถึงเราบน [Discord](https://discord.stack-auth.com)

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 การพัฒนาและการมีส่วนร่วม

ส่วนนี้สำหรับคุณหากต้องการมีส่วนร่วมในโปรเจกต์ Stack Auth หรือรันแดชบอร์ด Stack Auth บนเครื่องของคุณ

**สำคัญ**: กรุณาอ่าน[แนวทางการมีส่วนร่วม](CONTRIBUTING.md)อย่างละเอียดและเข้าร่วม[Discord ของเรา](https://discord.stack-auth.com)หากคุณต้องการช่วยเหลือ

### ความต้องการ

- Node v20
- pnpm v9
- Docker

### การตั้งค่า

หมายเหตุ: แนะนำ RAM 24 GB ขึ้นไปเพื่อประสบการณ์การพัฒนาที่ราบรื่น

ในเทอร์มินัลใหม่:

```sh
pnpm install
pnpm build:packages
pnpm codegen
pnpm restart-deps
pnpm dev

# ในเทอร์มินัลอื่น รันการทดสอบในโหมดเฝ้าดู
pnpm test
```

ตอนนี้คุณสามารถเปิดหน้าเริ่มต้นการพัฒนาได้ที่ [http://localhost:8100](http://localhost:8100) จากที่นั่นคุณสามารถไปที่แดชบอร์ดที่ [http://localhost:8101](http://localhost:8101), API บนพอร์ต 8102, สาธิตบนพอร์ต 8103, เอกสารบนพอร์ต 8104, Inbucket (อีเมล) บนพอร์ต 8105 และ Prisma Studio บนพอร์ต 8106 ดูหน้าเริ่มต้นการพัฒนาสำหรับรายการบริการทั้งหมดที่กำลังทำงาน

IDE ของคุณอาจแสดงข้อผิดพลาดในทุกการ import `@stackframe/XYZ` ในการแก้ไข ให้รีสตาร์ทเซิร์ฟเวอร์ภาษา TypeScript เช่น ใน VSCode คุณสามารถเปิดคอมมานด์พาเลทท์ (Ctrl+Shift+P) และรัน `Developer: Reload Window` หรือ `TypeScript: Restart TS server`

ไฟล์ .env ที่กรอกข้อมูลไว้ล่วงหน้าสำหรับการตั้งค่าด้านล่างมีให้ใช้และถูกใช้เป็นค่าเริ่มต้นใน `.env.development` ในแต่ละแพ็กเกจ อย่างไรก็ตาม หากคุณสร้างบิลด์สำหรับโปรดักชัน (เช่น ด้วย `pnpm run build`) คุณต้องระบุตัวแปรสภาพแวดล้อมด้วยตัวเอง (ดูด้านล่าง)

### คำสั่งที่มีประโยชน์

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

หมายเหตุ: เมื่อทำงานกับ AI คุณควรเปิดแท็บเทอร์มินัลที่มีเซิร์ฟเวอร์พัฒนาไว้เพื่อให้ AI สามารถรันคิวรีได้

## ❤ ผู้มีส่วนร่วม

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
