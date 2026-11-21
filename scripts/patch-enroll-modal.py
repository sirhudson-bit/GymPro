# افزودن مودال ثبت اثر انگشت به صفحهٔ دستگاه‌ها
import io

p = 'components/views/BioDevices.tsx'
s = open(p, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'


def L(text: str) -> str:
    return text.replace('\n', nl)


# ۱) دکمهٔ «ثبت اثر انگشت»
old = '                  <Button variant="ghost" onClick={() => setMap({ device: d, userNo: \'\', memberId: \'\' })}>نگاشت شناسه</Button>'
new = L(
    '                  <Button onClick={() => setEnroll(d)} icon={<Fingerprint size={13} />}>ثبت اثر انگشت</Button>\n'
    '                  <Button variant="ghost" onClick={() => setMap({ device: d, userNo: \'\', memberId: \'\' })}>نگاشت شناسه</Button>'
)
assert old in s, 'enroll button anchor missing'
s = s.replace(old, new, 1)

# ۲) state
old2 = '  const [map, setMap] = useState<{ device: any; userNo: string; memberId: string } | null>(null);'
new2 = L(
    '  const [map, setMap] = useState<{ device: any; userNo: string; memberId: string } | null>(null);\n'
    '  const [enroll, setEnroll] = useState<any | null>(null);'
)
assert old2 in s, 'map state anchor missing'
s = s.replace(old2, new2, 1)

# ۳) رندر مودال
old3 = '      <MapModal open={Boolean(map)} data={map} onClose={() => setMap(null)} onSaved={() => { setMap(null); load(); }} />'
new3 = L(
    '      <MapModal open={Boolean(map)} data={map} onClose={() => setMap(null)} onSaved={() => { setMap(null); load(); }} />\n'
    '\n'
    '      <EnrollModal device={enroll} onClose={() => setEnroll(null)} onChanged={load} />'
)
assert old3 in s, 'map modal anchor missing'
s = s.replace(old3, new3, 1)

component = r'''
/* ─────────── ثبت اثر انگشت برای اعضا ─────────── */

const ENROLL_STEPS: Record<string, string[]> = {
  zkteco: [
    'روی دستگاه: Menu → User Mgt → New User (یا User → Add).',
    'User ID را دقیقاً برابر شمارهٔ عضویت بگذار (مثل ۱۲۳) — همین عدد کلید اتصال است.',
    'نام عضو را وارد کن و اثر انگشت را سه بار بزن (برای کیفیت بهتر ۲ انگشت).',
    'اگر کارت RFID دارد همان‌جا ثبت کن؛ رمز عددی اختیاری است.',
    'Save بزن. از این به بعد هر بار انگشت بزند، رکورد در جیم‌پرو ثبت می‌شود.',
  ],
  suprema: [
    'در BioStar 2 (مرورگر) → User → Add User.',
    'User ID را برابر شمارهٔ عضویت جیم‌پرو بگذار.',
    'در Credential → Fingerprint، روی دستگاه اثر انگشت را ۲ تا ۳ بار ثبت کن.',
    'ذخیره کن؛ سپس در همین صفحه «خواندن رکوردها» را بزن.',
  ],
  futronic: [
    'در نرم‌افزار فوترونیک برای عضو یک User با شناسهٔ برابر شمارهٔ عضویت بساز.',
    'اثر انگشت را در همان نرم‌افزار ثبت و ذخیره کن.',
    'خروجی تردد را در همان پوشهٔ CSV بریز تا جیم‌پرو بخواند.',
  ],
};

function EnrollModal({ device, onClose, onChanged }: { device: any | null; onClose: () => void; onChanged: () => void }) {
  const toast = useStore((s) => s.toast);
  const [pending, setPending] = useState<any[]>([]);
  const [enrolled, setEnrolled] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    if (!device) return;
    try {
      const [p, e] = await Promise.all([api.bioUnenrolled(device.id), api.bioMapList(device.id)]);
      setPending(p as any[]);
      setEnrolled(e as any[]);
    } catch (err: any) {
      toast(err.message, 'bad');
    }
  }, [device, toast]);

  useEffect(() => {
    if (device) load();
  }, [device, load]);

  if (!device) return null;
  const steps = ENROLL_STEPS[device.brand] ?? [];
  const filtered = pending.filter((m) => !q.trim() || m.fullName.includes(q) || String(m.memberNo).includes(q));

  return (
    <Modal open onClose={onClose} wide title={`ثبت اثر انگشت — ${device.label}`} footer={<Button onClick={onClose}>بستن</Button>}>
      <div className="rounded-xl p-3 mb-3 text-[12px] leading-6" style={{ background: 'var(--brand-wash)', border: '1px solid var(--brand-line)' }}>
        <p className="font-bold mb-1">اثر انگشت روی خود دستگاه ثبت می‌شود، نه در جیم‌پرو</p>
        <ol className="pr-4 list-decimal">
          {steps.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        <p className="mt-1" style={{ color: 'var(--muted)' }}>
          تمپلیت روی دستگاه می‌ماند؛ جیم‌پرو فقط نگه می‌دارد «چه کسی روی کدام دستگاه ثبت شده» تا بدانی چه کسی مانده است.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h3 className="font-bold text-[13px]">بدون اثر انگشت روی این دستگاه ({toPersianDigits(filtered.length)})</h3>
        <div className="flex-1" />
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی نام یا شماره" style={{ width: 200 }} aria-label="جستجوی عضو" />
      </div>
      <Table head={['شمارهٔ عضویت', 'نام', 'موبایل', '']} empty={filtered.length === 0} minWidth={520}>
        {filtered.slice(0, 200).map((m) => (
          <tr key={m.id}>
            <td className="td tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{toPersianDigits(m.memberNo)}</td>
            <td className="td font-semibold">{m.fullName}</td>
            <td className="td tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{toPersianDigits(m.mobile ?? '')}</td>
            <td className="td">
              <Button
                variant="ghost"
                disabled={busy === m.id}
                icon={<CheckCircle2 size={13} />}
                onClick={async () => {
                  setBusy(m.id);
                  try {
                    await api.bioMapAdd({ deviceId: device.id, userNo: String(m.memberNo), memberId: m.id });
                    toast(`ثبت شد: ${m.fullName}`);
                    await load();
                    onChanged();
                  } catch (e: any) {
                    toast(e.message, 'bad');
                  } finally {
                    setBusy('');
                  }
                }}
              >
                ثبت شد
              </Button>
            </td>
          </tr>
        ))}
      </Table>

      <h3 className="font-bold text-[13px] mt-4 mb-2">ثبت‌شده روی این دستگاه ({toPersianDigits(enrolled.length)})</h3>
      <Table head={['شناسه دستگاه', 'عضو', 'تاریخ ثبت', '']} empty={enrolled.length === 0} minWidth={520}>
        {enrolled.map((m) => (
          <tr key={m.id}>
            <td className="td tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{m.device_user_no}</td>
            <td className="td">{m.memberName}</td>
            <td className="td">{m.enrolled_at ? formatJalali(m.enrolled_at, { withTime: true }) : '—'}</td>
            <td className="td">
              <Button
                variant="ghost"
                icon={<Trash2 size={13} />}
                onClick={async () => {
                  try {
                    await api.bioMapRemove(m.id);
                    await load();
                    onChanged();
                  } catch (e: any) {
                    toast(e.message, 'bad');
                  }
                }}
              >
                حذف نگاشت
              </Button>
            </td>
          </tr>
        ))}
      </Table>
    </Modal>
  );
}
'''

s = s.rstrip() + L(component)
open(p, 'w', encoding='utf-8', newline='').write(s)
print('enroll modal added')
