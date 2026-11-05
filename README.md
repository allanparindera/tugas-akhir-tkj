# Portal Tugas Akhir TKJ (SMKS Kartika X-1)

Portal Pengumpulan dan Verifikasi Uji Pakai Tugas Akhir untuk siswa kelas XII TKJ 1 dan XII TKJ 2 SMKS Kartika X-1 Tahun Ajaran 2026/2027.

## Fitur Utama
- **Aturan Mutlak:** Karya wajib sudah jadi dan siap digunakan (bukan mockup, slide, atau proposal).
- **2 Mode Rilis:**
  1. *Live Webview:* URL web `https://` aktif yang dapat langsung diuji di split-screen inspector (dukungan mode layar Desktop & HP 390px).
  2. *File Install / Paket Siap Pakai:* APK, EXE, Bot, atau skrip otomasi lengkap dengan target perangkat, panduan instalasi, dan akses demo.
- **Validasi Keras:** Tolak otomatis link `localhost` dan IP privat.
- **Roster Otomatis:** Terhubung langsung dengan 55 siswa (27 siswa XII TKJ 1 & 28 siswa XII TKJ 2).
- **Keamanan Mandiri:** Siswa mengunci karyanya dengan PIN 4 digit untuk revisi mandiri.
- **Panel Penguji Guru:**
  - Login password guru (default: `guru123`).
  - Ganti password guru langsung di dalam web.
  - Rubrik kelulusan: Fungsionalitas (40%), UI/UX (30%), Teknis (30%).
  - Status kelayakan: `SIAP PAKAI`, `MENUNGGU UJI`, `REVISI WAJIB` (disertai catatan perbaikan untuk siswa).
  - Export nilai dan tautan karya ke CSV per kelas.
  - Reset PIN siswa jika lupa.

## Menjalankan Lokal
```bash
npm install
npm run dev
# Buka http://localhost:3005
```

## Pengujian Otomatis
```bash
npm test
```
