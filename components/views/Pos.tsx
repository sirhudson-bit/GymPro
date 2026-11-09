'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Minus, Package, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Badge, Button, Empty, Field, Modal, MoneyInput, Select, Table, TextInput, tomanToRial } from '@/components/ui';
import { formatJalali, formatMoney, toPersianDigits } from '@/lib/format';

export default function Pos() {
  const toast = useStore((s) => s.toast);
  const [products, setProducts] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [cart, setCart] = useState<{ productId: string; name: string; qty: number; price: number }[]>([]);
  const [member, setMember] = useState<any | null>(null);
  const [memberQ, setMemberQ] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [method, setMethod] = useState('cash');
  const [tab, setTab] = useState<'sell' | 'products' | 'sales'>('sell');
  const [newProduct, setNewProduct] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api.products(true), api.sales()]);
      setProducts(p as any[]);
      setSales(s as any[]);
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (memberQ.length < 2) return setMembers([]);
    const t = setTimeout(() => {
      api.members({ q: memberQ, limit: 6 }).then((r) => setMembers(r as any[])).catch(() => setMembers([]));
    }, 200);
    return () => clearTimeout(t);
  }, [memberQ]);

  const total = useMemo(() => cart.reduce((s, l) => s + l.price * l.qty, 0), [cart]);

  function add(p: any) {
    setCart((c) => {
      const found = c.find((l) => l.productId === p.id);
      if (found) return c.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { productId: p.id, name: p.name, qty: 1, price: p.price_irr }];
    });
  }

  async function checkout() {
    try {
      if (cart.length === 0) throw new Error('سبد خالی است');
      const res: any = await api.sell({ memberId: member?.id ?? null, items: cart.map((l) => ({ productId: l.productId, qty: l.qty })), method });
      toast(`فروش ثبت شد — ${formatMoney(res.total)} ریال`);
      setCart([]);
      setMember(null);
      load();
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--edge)' }}>
          {([['sell', 'فروش'], ['products', 'کالاها'], ['sales', 'فاکتورها']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className="px-3 py-1.5 text-[12.5px]" aria-pressed={tab === k}
              style={{ background: tab === k ? 'var(--brand)' : 'transparent', color: tab === k ? 'var(--brand-ink)' : 'var(--ink)', fontWeight: tab === k ? 700 : 500 }}>{label}</button>
          ))}
        </div>
        <div className="flex-1" />
        {tab === 'products' ? <Button onClick={() => setNewProduct(true)} icon={<Plus size={15} />}>کالای جدید</Button> : null}
      </div>

      {tab === 'sell' ? (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-2">
            {products.filter((p) => p.is_active).map((p) => (
              <button key={p.id} onClick={() => add(p)} className="card p-3 text-right hover:border-[var(--brand)]" style={{ opacity: p.stock_qty > 0 ? 1 : 0.5 }}>
                <p className="font-semibold text-[13px]">{p.name}</p>
                <p className="text-[12px] tabular-nums mt-1" style={{ color: 'var(--brand)' }}>{formatMoney(p.price_irr)} ریال</p>
                <p className="text-[11px] mt-1" style={{ color: p.stock_qty <= p.low_stock_threshold ? 'var(--bad)' : 'var(--muted)' }}>موجودی: {toPersianDigits(p.stock_qty)}</p>
              </button>
            ))}
            {products.length === 0 ? <div className="col-span-3"><Empty title="کالایی ثبت نشده" hint="از تبِ کالاها اضافه کنید." /></div> : null}
          </div>

          <div className="card p-4 h-fit">
            <h2 className="font-bold text-[14px] mb-2 flex items-center gap-1.5"><ShoppingCart size={15} /> سبد فروش</h2>
            {cart.length === 0 ? <Empty title="سبد خالی است" /> : (
              <div className="space-y-1.5 mb-3">
                {cart.map((l) => (
                  <div key={l.productId} className="flex items-center justify-between text-[12.5px]">
                    <span className="flex-1">{l.name}</span>
                    <div className="flex items-center gap-1">
                      <button className="btn btn-ghost px-1.5 py-0.5" aria-label={`کاهش ${l.name}`} onClick={() => setCart((c) => c.map((x) => (x.productId === l.productId ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}><Minus size={12} /></button>
                      <span className="tabular-nums w-6 text-center">{toPersianDigits(l.qty)}</span>
                      <button className="btn btn-ghost px-1.5 py-0.5" aria-label={`افزایش ${l.name}`} onClick={() => setCart((c) => c.map((x) => (x.productId === l.productId ? { ...x, qty: x.qty + 1 } : x)))}><Plus size={12} /></button>
                      <button className="btn btn-ghost px-1.5 py-0.5" aria-label={`حذف ${l.name}`} onClick={() => setCart((c) => c.filter((x) => x.productId !== l.productId))}><Trash2 size={12} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 text-[13px] flex justify-between font-bold" style={{ borderTop: '1px solid var(--edge)' }}>
              <span>جمع</span>
              <span className="tabular-nums">{formatMoney(total)} ریال</span>
            </div>

            <div className="mt-3">
              <Field label="عضو (برای کیف پول/نسیه)">
                <TextInput value={member ? member.full_name : memberQ} onChange={(e) => { setMember(null); setMemberQ(e.target.value); }} placeholder="نام یا موبایل" />
              </Field>
              {!member && members.length > 0 ? (
                <div className="card mb-2 max-h-28 overflow-y-auto">
                  {members.map((m) => (
                    <button key={m.id} className="w-full text-right px-2 py-1 text-[12px] hover:bg-black/5" onClick={() => { setMember(m); setMemberQ(''); }}>{m.full_name}</button>
                  ))}
                </div>
              ) : null}
              <Field label="روش پرداخت">
                <Select value={method} onChange={setMethod} ariaLabel="روش پرداخت" options={[{ value: 'cash', label: 'نقدی' }, { value: 'card_to_card', label: 'کارت به کارت' }, { value: 'wallet', label: 'کیف پول' }, { value: 'credit', label: 'نسیه' }]} />
              </Field>
              <Button className="w-full" onClick={checkout} disabled={cart.length === 0}>ثبت فروش</Button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'products' ? (
        <Table head={['کالا', 'قیمت (ریال)', 'هزینه', 'موجودی', 'حد هشدار', '']} empty={products.length === 0}>
          {products.map((p) => (
            <tr key={p.id}>
              <td className="td font-semibold">{p.name}</td>
              <td className="td tabular-nums">{formatMoney(p.price_irr)}</td>
              <td className="td tabular-nums">{formatMoney(p.cost_irr)}</td>
              <td className="td"><Badge tone={p.stock_qty <= p.low_stock_threshold ? 'bad' : 'ok'}>{toPersianDigits(p.stock_qty)}</Badge></td>
              <td className="td">{toPersianDigits(p.low_stock_threshold)}</td>
              <td className="td">
                <Button variant="ghost" icon={<Package size={13} />} onClick={async () => {
                  const qty = window.prompt('تعداد ورودی جدید به انبار:', '10');
                  if (!qty) return;
                  try {
                    await api.restock({ productId: p.id, qty: Number(qty), note: 'ورود انبار' });
                    toast('موجودی به‌روز شد');
                    load();
                  } catch (e: any) { toast(e.message, 'bad'); }
                }}>ورود انبار</Button>
              </td>
            </tr>
          ))}
        </Table>
      ) : null}

      {tab === 'sales' ? (
        <Table head={['شماره', 'تاریخ', 'عضو', 'مبلغ (ریال)', 'روش']} empty={sales.length === 0}>
          {sales.map((s) => (
            <tr key={s.id}>
              <td className="td tabular-nums">{toPersianDigits(s.sale_no)}</td>
              <td className="td">{formatJalali(s.sold_at, { withTime: true })}</td>
              <td className="td">{s.memberName ?? 'مشتری آزاد'}</td>
              <td className="td tabular-nums font-semibold">{formatMoney(s.total_irr)}</td>
              <td className="td">{s.method === 'cash' ? 'نقدی' : s.method === 'wallet' ? 'کیف پول' : s.method === 'credit' ? 'نسیه' : 'کارت'}</td>
            </tr>
          ))}
        </Table>
      ) : null}

      <NewProduct open={newProduct} onClose={() => setNewProduct(false)} onSaved={() => { setNewProduct(false); load(); }} />
    </div>
  );
}

function NewProduct({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [stock, setStock] = useState('');

  return (
    <Modal open={open} onClose={onClose} title="کالای جدید" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button>
      <Button onClick={async () => {
        try {
          await api.createProduct({ name, priceIrr: tomanToRial(price), costIrr: tomanToRial(cost), stockQty: Number(stock) || 0 });
          toast('کالا ثبت شد');
          setName(''); setPrice(''); setCost(''); setStock('');
          onSaved();
        } catch (e: any) { toast(e.message, 'bad'); }
      }}>ثبت</Button></>}>
      <Field label="نام کالا" required><TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="قیمت فروش (تومان)" required><MoneyInput value={price} onChange={setPrice} /></Field>
        <Field label="قیمت خرید (تومان)"><MoneyInput value={cost} onChange={setCost} /></Field>
        <Field label="موجودی اولیه"><TextInput value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, ''))} dir="ltr" style={{ textAlign: 'right' }} /></Field>
      </div>
    </Modal>
  );
}
