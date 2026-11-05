import crypto from 'node:crypto';
import fs from 'node:fs';
import { neon } from '@neondatabase/serverless';

const CLASSES = ['XII TKJ 1', 'XII TKJ 2'];
const CATEGORIES = ['Web App', 'Android / Desktop', 'Jaringan & Otomasi', 'Bot / IoT / CLI'];
const MODES = ['WEB_LIVE', 'INSTALLABLE'];
const STATUSES = ['MENUNGGU UJI', 'SIAP PAKAI', 'REVISI WAJIB'];

const SECRET = process.env.SESSION_SECRET || 'ta-tkj-secret-2026';
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'guru123';
const DEFAULT_ADMIN_NAME = process.env.ADMIN_NAME || 'Allan Parindera, S.Kom';

export function findDbUrl(env) {
  const pref = ['DATABASE_URL', 'POSTGRES_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL'];
  for (const k of [...pref, ...Object.keys(env).sort()]) {
    const m = String(env[k] || '').match(/postgres(?:ql)?:\/\/[^\s'"`]+/);
    if (m) return m[0];
  }
}

let q = globalThis.__q;
if (!q) {
  const dbUrl = findDbUrl(process.env);
  if (dbUrl) {
    const sql = neon(dbUrl);
    q = (text, params = []) => sql.query(text, params);
  } else {
    const names = Object.keys(process.env).filter(k => /DATABASE|POSTGRES|PG|NEON/i.test(k));
    q = () => {
      throw new HttpError(500, 'Database belum terhubung. Env terdeteksi: ' + (names.join(', ') || '(kosong)') + '. Hubungkan Neon Postgres di Vercel lalu Redeploy.');
    };
  }
}

let ready;
async function init() {
  const [{ t }] = await q("select to_regclass('ta_tkj.students') as t");
  if (t) return;
  const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  for (const stmt of schema.split(/;\s*\n/).map(s => s.trim()).filter(Boolean)) {
    await q(stmt);
  }
}

class HttpError extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
}
const fail = (code, msg) => { throw new HttpError(code, msg); };

const b64 = s => Buffer.from(s).toString('base64url');
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const makeToken = p => {
  const body = b64(JSON.stringify({ ...p, exp: Date.now() + 30 * 864e5 }));
  return body + '.' + sign(body);
};
function readToken(t) {
  const [body, sig] = String(t || '').split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() ? p : null;
}

const hashSecret = (val, salt = crypto.randomBytes(16).toString('hex')) =>
  salt + ':' + crypto.scryptSync(String(val), salt, 32).toString('hex');

function checkSecret(val, stored) {
  if (!stored) return false;
  const [salt, h] = stored.split(':');
  if (!salt || !h) return false;
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(String(val), salt, 32));
}

const samePlain = (a, b) =>
  crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

const cleanText = (v, max = 300) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const cleanMultiline = (v, max = 1200) => String(v ?? '').trim().slice(0, max);
const int = (v, label, min = 0, max = 1e9) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${label} tidak valid`);
  return n;
};

export function validateProductUrl(rawUrl, mode) {
  const u = String(rawUrl ?? '').trim();
  if (!u) fail(400, 'URL karya wajib diisi.');
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    fail(400, 'Format URL tidak valid. Gunakan awalan https://');
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    fail(400, 'URL wajib menggunakan protokol https:// atau http://');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    fail(400, 'URL lokal (localhost / IP privat) ditolak. Wajib URL publik yang sudah online atau link rilis siap pakai.');
  }
  if (mode === 'WEB_LIVE') {
    if (/docs\.google\.com\/(document|presentation|spreadsheets)/i.test(u)) {
      fail(400, 'Mode Live Webview wajib berupa aplikasi web yang bisa dijalankan, bukan dokumen/slide.');
    }
  }
  return parsed.toString();
}

async function getAdminConfig() {
  const rows = await q("select key, value from ta_tkj.settings where key in ('admin_pass_hash', 'admin_name', 'deadline')");
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    passHash: map.admin_pass_hash || null,
    name: map.admin_name || DEFAULT_ADMIN_NAME,
    deadline: map.deadline || '2026-12-18'
  };
}

async function verifyAdminPassword(inputPass) {
  const cfg = await getAdminConfig();
  const ok = cfg.passHash
    ? checkSecret(String(inputPass || ''), cfg.passHash)
    : samePlain(String(inputPass || ''), DEFAULT_ADMIN_PASSWORD);
  return { ok, name: cfg.name };
}

async function buildState(user) {
  const cfg = await getAdminConfig();
  const students = await q(
    `select id, kelas, no_absen, name, project_id, (pin_hash is not null) as has_pin
     from ta_tkj.students
     order by kelas asc, no_absen asc`
  );
  const projects = await q(
    `select p.id, p.kelas, p.lead_student_id as student_id, p.title, p.category, p.delivery_mode, p.primary_url, p.repo_url,
            p.target_platform, p.install_guide, p.demo_account, p.summary, p.status,
            p.score_func, p.score_ui, p.score_tech, p.score_total::float as score_total,
            p.reviewer_note, p.submitted_at, p.updated_at, p.verified_at,
            s.name as student_name, s.no_absen as student_no_absen
     from ta_tkj.projects p
     left join ta_tkj.students s on s.id = p.lead_student_id
     order by p.updated_at desc, p.id desc`
  );
  const enrichedProjects = projects.map(p => ({
    ...p,
    student: { id: p.student_id, no_absen: p.student_no_absen, name: p.student_name },
    members: [{ id: p.student_id, no_absen: p.student_no_absen, name: p.student_name }]
  }));
  return {
    students,
    projects: enrichedProjects,
    settings: {
      adminName: cfg.name,
      deadline: cfg.deadline,
      customPass: Boolean(cfg.passHash)
    },
    user: user || { role: 'guest' }
  };
}

export default async function handler(req, res) {
  try {
    ready ||= init();
    await ready;

    const raw = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = raw.action || 'state';
    const authHeader = req.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const session = readToken(token);
    const isAdmin = session?.role === 'admin';

    if (action === 'state') {
      return res.status(200).json(await buildState(isAdmin ? session : { role: 'guest' }));
    }

    if (action === 'login') {
      const { ok, name } = await verifyAdminPassword(raw.password);
      if (!ok) fail(401, 'Password penguji salah.');
      const user = { role: 'admin', name };
      return res.status(200).json({ token: makeToken(user), user });
    }

    if (action === 'changeAdminPassword') {
      if (!isAdmin) fail(403, 'Akses khusus guru penguji.');
      const { ok } = await verifyAdminPassword(raw.old_password);
      if (!ok) fail(401, 'Password lama tidak sesuai.');
      const newPass = String(raw.new_password || '').trim();
      if (newPass.length < 6) fail(400, 'Password baru minimal 6 karakter.');
      const newName = cleanText(raw.admin_name || session.name || DEFAULT_ADMIN_NAME, 80);
      const passHash = hashSecret(newPass);
      await q(
        `insert into ta_tkj.settings(key, value) values ('admin_pass_hash', $1), ('admin_name', $2)
         on conflict (key) do update set value = excluded.value`,
        [passHash, newName]
      );
      const user = { role: 'admin', name: newName };
      return res.status(200).json({ token: makeToken(user), user });
    }

    if (action === 'submitProject') {
      const studentId = int(raw.student_id || raw.lead_student_id, 'Siswa pengumpul', 1);
      const studentRows = await q('select * from ta_tkj.students where id = $1', [studentId]);
      const student = studentRows[0];
      if (!student) fail(404, 'Data siswa tidak ditemukan di daftar absen.');

      const pin = String(raw.pin || '').trim();
      if (!isAdmin) {
        if (!/^\d{4}$/.test(pin)) fail(400, 'PIN siswa wajib 4 digit angka (contoh: 1234).');
        if (student.pin_hash && !checkSecret(pin, student.pin_hash)) {
          fail(401, 'PIN 4 digit salah. Gunakan PIN saat pertama kali kumpul atau minta guru reset PIN.');
        }
      }

      const title = cleanText(raw.title, 120);
      if (title.length < 4) fail(400, 'Judul projek minimal 4 karakter.');

      const category = cleanText(raw.category, 40);
      if (!CATEGORIES.includes(category)) fail(400, 'Kategori projek tidak valid.');

      const deliveryMode = cleanText(raw.delivery_mode, 20);
      if (!MODES.includes(deliveryMode)) fail(400, 'Pilih mode rilis: Live Webview atau File Install.');

      const primaryUrl = validateProductUrl(raw.primary_url, deliveryMode);
      const repoUrl = raw.repo_url ? validateProductUrl(raw.repo_url, 'REPO') : '';
      const targetPlatform = cleanText(raw.target_platform || (deliveryMode === 'WEB_LIVE' ? 'Browser (Web Mobile & Desktop)' : ''), 80);
      const installGuide = cleanMultiline(raw.install_guide, 1000);
      if (deliveryMode === 'INSTALLABLE' && installGuide.length < 10) {
        fail(400, 'Mode File Install wajib menyertakan langkah instalasi / cara menjalankan minimal 10 karakter.');
      }
      const demoAccount = cleanText(raw.demo_account, 200);
      if (demoAccount.length < 3) {
        fail(400, 'Wajib isi akun demo uji coba (atau tulis "Tanpa login - langsung pakai").');
      }
      const summary = cleanMultiline(raw.summary, 600);
      if (summary.length < 10) {
        fail(400, 'Jelaskan fungsi utama aplikasi minimal 10 karakter.');
      }

      if (!student.pin_hash && /^\d{4}$/.test(pin)) {
        await q('update ta_tkj.students set pin_hash = $1 where id = $2', [hashSecret(pin), studentId]);
      }

      let projectId = student.project_id;
      if (projectId) {
        const existing = (await q('select id, status from ta_tkj.projects where id = $1', [projectId]))[0];
        if (!existing) projectId = null;
      }

      if (projectId) {
        await q(
          `update ta_tkj.projects
           set title = $1, category = $2, delivery_mode = $3, primary_url = $4, repo_url = $5,
               target_platform = $6, install_guide = $7, demo_account = $8, summary = $9,
               status = case when status = 'REVISI WAJIB' then 'MENUNGGU UJI' else status end,
               updated_at = now()
           where id = $10`,
          [title, category, deliveryMode, primaryUrl, repoUrl, targetPlatform, installGuide, demoAccount, summary, projectId]
        );
      } else {
        const ins = await q(
          `insert into ta_tkj.projects(
             kelas, lead_student_id, title, category, delivery_mode, primary_url, repo_url,
             target_platform, install_guide, demo_account, summary
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           returning id`,
          [student.kelas, studentId, title, category, deliveryMode, primaryUrl, repoUrl, targetPlatform, installGuide, demoAccount, summary]
        );
        projectId = ins[0].id;
        await q('update ta_tkj.students set project_id = $1 where id = $2', [projectId, studentId]);
      }

      return res.status(200).json({ ok: true, project_id: projectId, ...(await buildState(isAdmin ? session : { role: 'guest' })) });
    }

    if (action === 'gradeProject') {
      if (!isAdmin) fail(403, 'Hanya guru penguji yang dapat memberi nilai dan verifikasi.');
      const pid = int(raw.project_id, 'ID Projek', 1);
      const status = cleanText(raw.status, 30);
      if (!STATUSES.includes(status)) fail(400, 'Status verifikasi tidak valid.');
      const sFunc = int(raw.score_func ?? 0, 'Nilai Fungsionalitas', 0, 100);
      const sUi = int(raw.score_ui ?? 0, 'Nilai UI/UX', 0, 100);
      const sTech = int(raw.score_tech ?? 0, 'Nilai Teknis', 0, 100);
      const total = Math.round((sFunc * 0.4 + sUi * 0.3 + sTech * 0.3) * 10) / 10;
      const note = cleanMultiline(raw.reviewer_note, 600);
      if (status === 'REVISI WAJIB' && note.length < 4) {
        fail(400, 'Wajib tulis alasan revisi agar siswa tahu bagian yang harus diperbaiki.');
      }

      const upd = await q(
        `update ta_tkj.projects
         set status = $1, score_func = $2, score_ui = $3, score_tech = $4, score_total = $5,
             reviewer_note = $6, verified_at = now(), updated_at = now()
         where id = $7 returning id`,
        [status, sFunc, sUi, sTech, total, note, pid]
      );
      if (!upd.length) fail(404, 'Projek tidak ditemukan.');
      return res.status(200).json({ ok: true, ...(await buildState(session)) });
    }

    if (action === 'resetStudentPin') {
      if (!isAdmin) fail(403, 'Hanya guru penguji yang dapat mereset PIN siswa.');
      const sid = int(raw.student_id, 'ID Siswa', 1);
      await q('update ta_tkj.students set pin_hash = null where id = $1', [sid]);
      return res.status(200).json({ ok: true, ...(await buildState(session)) });
    }

    if (action === 'deleteProject') {
      if (!isAdmin) fail(403, 'Hanya guru penguji yang dapat menghapus pengumpulan.');
      const pid = int(raw.project_id, 'ID Projek', 1);
      await q('update ta_tkj.students set project_id = null where project_id = $1', [pid]);
      await q('delete from ta_tkj.projects where id = $1', [pid]);
      return res.status(200).json({ ok: true, ...(await buildState(session)) });
    }

    fail(400, `Aksi tidak dikenal: ${action}`);
  } catch (e) {
    const code = e instanceof HttpError ? e.code : 500;
    return res.status(code).json({ error: e.message || 'Terjadi kesalahan server' });
  }
}
