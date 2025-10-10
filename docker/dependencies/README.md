# Stack Auth 依赖服务配置

本目录包含 Stack Auth 开发环境所需的 Docker 容器配置。

## 配置选项

### 完整配置 (docker.compose.yaml)
包含所有16个服务容器，提供完整的开发和调试工具。

**启动/停止命令:**
```bash
pnpm run start-deps        # 启动所有依赖（16个容器）
pnpm run stop-deps         # 停止所有依赖
pnpm run restart-deps      # 重启所有依赖
```

**服务列表（16个容器）:**
1. **db** - PostgreSQL主数据库
2. **pghero** (端口8116) - PostgreSQL性能监控
3. **pgadmin** (端口8117) - 数据库管理界面
4. **supabase-studio** (端口8118) - 数据库可视化工具
5. **supabase-meta** - Supabase Studio后端
6. **inbucket** (端口8105) - 邮件测试服务器
7. **jaeger** (端口8107) - 分布式追踪
8. **svix-db** - Svix webhook数据库
9. **svix-redis** - Svix Redis缓存
10. **svix-server** (端口8113) - Webhook服务
11. **s3mock** (端口8121) - S3存储模拟器
12. **localstack** (端口8124) - AWS服务模拟器
13. **freestyle-mock** (端口8122) - Freestyle脚本执行器
14. **stripe-mock** (端口8123) - Stripe支付模拟器
15. **qstash** (端口8125) - 消息队列模拟器
16. **mcpjam-inspector** (端口8126) - MCP协议检查器

---

### 最小配置 (docker.compose.minimal.yaml) ⚡
**仅包含7个核心服务**，适合资源受限的开发环境或只需要基础功能的场景。

**启动/停止命令:**
```bash
pnpm run start-deps:minimal    # 启动最小依赖（7个容器）
pnpm run stop-deps:minimal     # 停止最小依赖
pnpm run restart-deps:minimal  # 重启最小依赖
```

**核心服务列表（7个容器）:**
1. **db** (端口5432) - PostgreSQL主数据库 ✅ 必需
2. **svix-db** - Svix webhook数据库 ✅ 必需
3. **svix-redis** - Svix Redis缓存 ✅ 必需
4. **svix-server** (端口8113) - Webhook管理服务 ✅ 必需
5. **inbucket** (端口8105/2500/1100) - 邮件测试服务器 ✅ 必需
6. **s3mock** (端口8121) - S3存储模拟器 ✅ 必需
7. **freestyle-mock** (端口8122) - 脚本执行模拟器 ✅ 必需

---

## 推荐使用场景

### 使用完整配置的情况：
- 需要调试数据库性能问题（使用 pghero/pgadmin）
- 开发支付相关功能（需要 stripe-mock）
- 调试分布式系统（需要 jaeger）
- 开发AWS相关集成（需要 localstack）
- 需要可视化数据库工具（使用 supabase-studio）

### 使用最小配置的情况：
- 日常开发工作 ✅ **推荐**
- 资源受限的开发环境（低配电脑）
- 只需要基本的API和认证功能
- 快速启动和测试

---

## 资源占用对比

| 配置 | 容器数量 | 内存占用（估算） | 启动时间 |
|------|---------|----------------|---------|
| 完整配置 | 16个 | ~4-6GB | ~30-60秒 |
| 最小配置 | 7个 | ~1-2GB | ~15-30秒 |

---

## 常见问题

### 如何在两种配置之间切换？

**从完整配置切换到最小配置:**
```bash
pnpm run stop-deps
pnpm run start-deps:minimal
```

**从最小配置切换到完整配置:**
```bash
pnpm run stop-deps:minimal
pnpm run start-deps
```

### 如何查看正在运行的容器？
```bash
docker ps --filter "name=stack-dependencies"
```

### 如何访问各个服务的界面？
- **Inbucket (邮件)**: http://localhost:8105
- **PgHero (数据库监控)**: http://localhost:8116 （仅完整配置）
- **PgAdmin (数据库管理)**: http://localhost:8117 （仅完整配置）
- **Supabase Studio**: http://localhost:8118 （仅完整配置）
- **Jaeger (追踪)**: http://localhost:8107 （仅完整配置）
- **Svix (Webhook)**: http://localhost:8113

### 遇到端口冲突怎么办？
如果某个端口已被占用，可以修改相应的 docker-compose 文件中的端口映射。

---

## 开发建议

1. **日常开发建议使用最小配置** (`pnpm run start-deps:minimal`)
2. 只在需要特定调试工具时切换到完整配置
3. 定期运行 `pnpm run restart-deps:minimal` 来清理数据和重置状态
4. 使用 `pnpm run dev:basic` 配合最小依赖以获得最佳性能

