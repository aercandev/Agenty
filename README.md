# Agenty

Bilgisayarında **zaten kurulu ve giriş yapılmış** yapay zeka CLI'larını (Claude Code, Codex, Gemini, Qwen, Cursor Agent, Copilot, OpenCode, Ollama) tek pencereden ve aynı anda çalıştıran, VS Code görünümlü, cross-platform (Windows / macOS / Linux) Electron uygulaması.

API anahtarı yok, login ekranı yok: her CLI kendi oturumunu kullanır. Agenty kimlik bilgisi saklamaz.

## Çalıştırma

```bash
npm install
npm run dev        # geliştirme (HMR)
npm run build      # out/ altına derler
npm run dist       # electron-builder ile kurulum paketi (release/)
npm test           # ayrıştırıcı ve orkestratör birim testleri
npm run typecheck
```

## Modlar

| Mod | Ne yapar |
|---|---|
| **Tekli** | Tek model; seçilen yetkiyle (salt okunur / düzenleme / tam yetki) çalışır. |
| **Analiz → Kod** | Analiz modeli salt okunur çalışıp plan çıkarır → (isteğe bağlı onay) → kodlama modeli planı çalışma klasöründe uygular. Değişen dosyalar `git status` ile gösterilir. |
| **Paralel** | Aynı istem birden fazla modele aynı anda gönderilir, yanıtlar yan yana gösterilir. Aynı klasörde yazma çakışmasını önlemek için salt okunurdur. |

## Mimari

```
src/
  shared/types.ts        main ↔ renderer ortak tipler ve IPC sözleşmesi
  main/
    index.ts             pencere, IPC kanalları
    env.ts               PATH çözümleme (macOS GUI login-shell PATH), exe bulma, süreç ağacı kapatma
    providers.ts         CLI tanımları: tespit, giriş kontrolü, model listesi, argüman kurulumu
    parsers.ts           stream-json / JSONL / düz metin çıktılarını ortak olaylara çevirir (saf, test edilebilir)
    runner.ts            tek CLI sürecini çalıştırır, akıtır, iptal / zaman aşımı
    orchestrator.ts      modlar, onay kapısı, resume, bağlam geçmişi, git değişiklik takibi
    store.ts             JSON tabanlı ayar + oturum deposu (userData/agenty)
  preload/index.ts       contextBridge ile güvenli `window.agenty` API'si
  renderer/src/          React arayüzü (activity bar, kenar çubuğu, oturum, istem, sihirbaz, ayarlar, komut paleti)
```

**İstem stdin üzerinden** verilir (Windows argüman kaçış sorunlarını ve uzunluk sınırlarını önler). Claude Code ve Codex kendi oturumlarını `--resume` / `exec resume` ile sürdürür; diğer CLI'lara son N tur bağlam olarak eklenir.

### Sağlayıcı ekleme

`src/main/providers.ts` içindeki `PROVIDERS` dizisine bir kayıt ekleyin: `bins`, `checkAuth`, `listModels`, `build` ve uygun `parser` (`claude-stream`, `codex-json`, `plain`). `ProviderId` tipine ve `PROVIDER_COLORS`'a da ekleyin.

## Kısayollar

`Ctrl+N` yeni oturum · `Ctrl+P` oturum aç · `Ctrl+Shift+P` komutlar · `Ctrl+Shift+F` ara · `Ctrl+B` kenar çubuğu · `Ctrl+,` ayarlar · `Ctrl+L` isteme odaklan · `Alt+1/2/3` mod

## Sorun giderme

- **CLI bulunamadı (macOS/Linux):** Agenty login shell PATH'ini okur; yine de bulunamazsa Ayarlar → Sağlayıcılar'dan exe yolunu elle girin.
- **Codex "model is not supported":** `~/.codex/config.toml` içindeki varsayılan model hesabınızda yoksa Agenty'de modeli açıkça seçin (liste `~/.codex/models_cache.json`'dan okunur).
- **`electron` başlamıyor:** `npm run postinstall` Electron ikilisini indirir.
