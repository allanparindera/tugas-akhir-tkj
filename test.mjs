import assert from 'node:assert/strict';

process.env.PORT = '3995';
const { server } = await import('./dev.mjs');
await new Promise(r => (server.listening ? r() : server.once('listening', r)));

let token = '';
const call = async (action, body = {}, t = token) => {
  const r = await fetch('http://localhost:3995/api', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(t ? { authorization: 'Bearer ' + t } : {})
    },
    body: JSON.stringify({ action, ...body })
  });
  return { status: r.status, ...(await r.json()) };
};

console.log('--- 1. Testing Initial State & Student Roster ---');
const init = await call('state');
assert.equal(init.status, 200);
assert.equal(init.students.length, 55, 'Total 55 students seeded (27 in TKJ 1, 28 in TKJ 2)');
const tkj1 = init.students.filter(s => s.kelas === 'XII TKJ 1');
const tkj2 = init.students.filter(s => s.kelas === 'XII TKJ 2');
assert.equal(tkj1.length, 27);
assert.equal(tkj2.length, 28);
assert.equal(tkj1[0].name, 'Adhani Wahyudi');
assert.equal(tkj1[0].no_absen, 1);
assert.equal(tkj1[26].name, 'Shapa Alipiandi');
assert.equal(tkj1[26].no_absen, 27);
assert.equal(tkj2[0].name, 'Abib Maulana');
assert.equal(tkj2[0].no_absen, 1);
assert.equal(tkj2[27].name, 'Tegar Suripto');
assert.equal(tkj2[27].no_absen, 28);

console.log('--- 2. Testing Anti-Slop Hard Gate: Localhost & Private IP Rejection ---');
const sid1 = tkj1[0].id;
const localTest1 = await call('submitProject', {
  lead_student_id: sid1,
  pin: '1234',
  title: 'Monitoring Jaringan Lokal',
  category: 'Web App',
  delivery_mode: 'WEB_LIVE',
  primary_url: 'http://localhost:3000',
  demo_account: 'admin/admin',
  summary: 'Aplikasi monitoring switch dan router internal.'
});
assert.equal(localTest1.status, 400, 'localhost must be rejected');
assert.match(localTest1.error, /URL lokal/i);

const localTest2 = await call('submitProject', {
  lead_student_id: sid1,
  pin: '1234',
  title: 'Monitoring Jaringan Lokal',
  category: 'Web App',
  delivery_mode: 'WEB_LIVE',
  primary_url: 'http://192.168.1.100:8080',
  demo_account: 'admin/admin',
  summary: 'Aplikasi monitoring switch dan router internal.'
});
assert.equal(localTest2.status, 400, '192.168.x.x must be rejected');

console.log('--- 3. Testing Missing Demo Account Rejection ---');
const noDemo = await call('submitProject', {
  lead_student_id: sid1,
  pin: '1234',
  title: 'Monitoring Jaringan Berbasis Web',
  category: 'Web App',
  delivery_mode: 'WEB_LIVE',
  primary_url: 'https://monitoring-tkj.vercel.app',
  demo_account: '',
  summary: 'Aplikasi monitoring switch dan router SMK.'
});
assert.equal(noDemo.status, 400, 'Empty demo account must be rejected');

console.log('--- 4. Testing Valid Student Submission & PIN Locking ---');
const sub1 = await call('submitProject', {
  lead_student_id: sid1,
  pin: '2468',
  title: 'Sistem Monitoring Bandwidth Hotspot MikroTik',
  category: 'Web App',
  delivery_mode: 'WEB_LIVE',
  primary_url: 'https://hotspot-mon.vercel.app',
  repo_url: 'https://github.com/fyara/hotspot-mon',
  demo_account: 'demo / pass1234',
  summary: 'Dashboard visual status antrean bandwidth dan voucher aktif mikrotik.'
});
assert.equal(sub1.status, 200, 'Submission success');
assert.ok(sub1.project_id);

// Check project in state
const stateAfterSub = await call('state');
const proj = stateAfterSub.projects.find(p => p.id === sub1.project_id);
assert.ok(proj);
assert.equal(proj.student_id, sid1, 'Student assigned as single author');
assert.equal(proj.status, 'MENUNGGU UJI');

console.log('--- 5. Testing PIN Verification on Update ---');
// Wrong PIN
const wrongPin = await call('submitProject', {
  lead_student_id: sid1,
  pin: '0000',
  title: 'Update Judul Salah PIN',
  category: 'Web App',
  delivery_mode: 'WEB_LIVE',
  primary_url: 'https://hotspot-mon.vercel.app',
  demo_account: 'demo / pass1234',
  summary: 'Pembaruan deskripsi karya oleh siswa.'
});
assert.equal(wrongPin.status, 401, 'Wrong PIN must be rejected');

// Correct PIN
const correctPin = await call('submitProject', {
  lead_student_id: sid1,
  pin: '2468',
  title: 'Sistem Monitoring Bandwidth Hotspot MikroTik v2',
  category: 'Web App',
  delivery_mode: 'WEB_LIVE',
  primary_url: 'https://hotspot-mon-v2.vercel.app',
  demo_account: 'demo / pass1234',
  summary: 'Pembaruan dashboard dengan grafik real-time traffic.'
});
assert.equal(correctPin.status, 200, 'Correct PIN accepted and updated');

console.log('--- 5b. Testing PIN Brute-Force Lockout (5 Fails -> 429) ---');
for (let i = 0; i < 4; i++) {
  const r = await call('submitProject', {
    lead_student_id: sid1,
    pin: '9999',
    title: 'Brute Force Test',
    category: 'Web App',
    delivery_mode: 'WEB_LIVE',
    primary_url: 'https://test.vercel.app',
    demo_account: 'test',
    summary: 'Brute force testing attempt.'
  });
  assert.equal(r.status, 401);
}
const locked = await call('submitProject', {
  lead_student_id: sid1,
  pin: '9999',
  title: 'Brute Force Test 5th',
  category: 'Web App',
  delivery_mode: 'WEB_LIVE',
  primary_url: 'https://test.vercel.app',
  demo_account: 'test',
  summary: 'Brute force testing attempt 5.'
});
assert.equal(locked.status, 429, 'Account must be locked with HTTP 429 after 5 failures');

console.log('--- 6. Testing Installable Mode Validation ---');
const sid2 = tkj2[0].id; // Abib Maulana
const installNoGuide = await call('submitProject', {
  lead_student_id: sid2,
  pin: '1122',
  title: 'MikroTik AutoConfig CLI Tool',
  category: 'Jaringan & Otomasi',
  delivery_mode: 'INSTALLABLE',
  primary_url: 'https://github.com/abib/mikrotik-cli/releases/download/v1.0/tool.zip',
  demo_account: 'Tanpa login',
  install_guide: 'pendek', // < 10 chars
  summary: 'CLI script Python untuk provisioning massal router.'
});
assert.equal(installNoGuide.status, 400, 'Installable without thorough guide rejected');

const installOk = await call('submitProject', {
  lead_student_id: sid2,
  pin: '1122',
  title: 'MikroTik AutoConfig CLI Tool',
  category: 'Jaringan & Otomasi',
  delivery_mode: 'INSTALLABLE',
  primary_url: 'https://github.com/abib/mikrotik-cli/releases/download/v1.0/tool.zip',
  target_platform: 'Python 3.10+ / Linux & Windows',
  install_guide: 'Ekstrak zip, jalankan pip install -r requirements.txt lalu python main.py --host 192.168.88.1',
  demo_account: 'Tanpa login - langsung CLI wizard',
  summary: 'CLI wizard untuk konfigurasi NAT, Queue, dan Hotspot dalam 3 menit.'
});
assert.equal(installOk.status, 200, 'Installable submission succeeded');

console.log('--- 7. Testing Admin Authentication & Role Protection ---');
// Guest cannot grade
const guestGrade = await call('gradeProject', {
  project_id: sub1.project_id,
  status: 'SIAP PAKAI',
  score_func: 90,
  score_ui: 85,
  score_tech: 85
});
assert.equal(guestGrade.status, 403, 'Guest cannot grade');

// Admin login
const loginFail = await call('login', { password: 'salah_password' });
assert.equal(loginFail.status, 401);

const loginOk = await call('login', { password: 'guru123' });
assert.equal(loginOk.status, 200);
token = loginOk.token;
assert.ok(token);

console.log('--- 8. Testing Teacher Grading & Verification Rubric ---');
const gradeRes = await call('gradeProject', {
  project_id: sub1.project_id,
  status: 'SIAP PAKAI',
  score_func: 90,
  score_ui: 85,
  score_tech: 95,
  reviewer_note: 'Aplikasi berfungsi sangat baik, responsive di layar ponsel, dan webhook mikrotik teruji lancar.'
});
assert.equal(gradeRes.status, 200);
const gradedProj = gradeRes.projects.find(p => p.id === sub1.project_id);
assert.equal(gradedProj.status, 'SIAP PAKAI');
assert.equal(gradedProj.score_func, 90);
// 90 * 0.4 + 85 * 0.3 + 95 * 0.3 = 36 + 25.5 + 28.5 = 90.0
assert.equal(gradedProj.score_total, 90);

console.log('--- 9. Testing Change Admin Password ---');
const changeWrongOld = await call('changeAdminPassword', {
  old_password: 'salah',
  new_password: 'gurubaru2026',
  admin_name: 'Allan Parindera, S.Kom'
});
assert.equal(changeWrongOld.status, 401);

const changePass = await call('changeAdminPassword', {
  old_password: 'guru123',
  new_password: 'gurubaru2026',
  admin_name: 'Allan Parindera, S.Kom (Kaprog)'
});
assert.equal(changePass.status, 200);
token = changePass.token;

// Old password rejected
const loginOld = await call('login', { password: 'guru123' });
assert.equal(loginOld.status, 401);

// New password accepted
const loginNew = await call('login', { password: 'gurubaru2026' });
assert.equal(loginNew.status, 200);
assert.equal(loginNew.user.name, 'Allan Parindera, S.Kom (Kaprog)');

console.log('--- 10. Testing Reset Student PIN by Teacher ---');
const resetRes = await call('resetStudentPin', { student_id: sid1 });
assert.equal(resetRes.status, 200);
const resetStudent = resetRes.students.find(s => s.id === sid1);
assert.equal(resetStudent.has_pin, false, 'PIN cleared successfully');

console.log('--- 11. Testing Bulk PIN Generation for Class ---');
const bulkRes = await call('bulkGeneratePins', { kelas: 'XII TKJ 1' });
assert.equal(bulkRes.status, 200);
assert.equal(bulkRes.pins.length, 27);
assert.ok(/^\d{4}$/.test(bulkRes.pins[0].pin));
assert.equal(bulkRes.students.filter(s => s.kelas === 'XII TKJ 1' && s.has_pin).length, 27);

console.log('--- ALL BACKEND & WORKFLOW TESTS PASSED ---');
server.close();
process.exit(0);
