import { useMemo, useRef, useState } from 'react'
import type { FormEvent, TouchEvent } from 'react'

type TabId = 'personal' | 'business' | 'notes'
type Category = 'Food' | 'Transport' | 'Shopping' | 'Bills' | 'Health' | 'Other'

type Expense = {
  id: string
  amountCents: number
  category: Category
  note: string
  createdAt: string
}

type DashboardStore = {
  expenses: Expense[]
}

const STORAGE_KEYS = {
  personal: 'money.pwa.personal.v1',
  business: 'money.pwa.business.v1',
  notes: 'money.pwa.notes.v1',
} as const

const CATEGORIES: Category[] = ['Food', 'Transport', 'Shopping', 'Bills', 'Health', 'Other']
const TABS: TabId[] = ['personal', 'business', 'notes']
const CATEGORY_COLORS: Record<Category, string> = {
  Food: '#34d399',
  Transport: '#60a5fa',
  Shopping: '#f472b6',
  Bills: '#fbbf24',
  Health: '#a78bfa',
  Other: '#9ca3af',
}

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const dateLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
})

const monthKey = (date = new Date()) => `${date.getFullYear()}-${date.getMonth()}`

const safeRead = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return fallback
    }
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const formatCents = (cents: number) => currency.format(cents / 100)

const dollarsToCents = (amount: number) => Math.round(amount * 100)

const parseCurrencyInputToCents = (value: string): number | null => {
  const compact = value.trim().replaceAll(' ', '')
  if (!compact) {
    return null
  }

  if (compact.includes('.') && compact.includes(',')) {
    return null
  }

  const normalized = compact.replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null
  }

  const [whole, fractional = ''] = normalized.split('.')
  const cents = Number(whole) * 100 + Number((fractional + '00').slice(0, 2))
  if (!Number.isFinite(cents) || cents <= 0) {
    return null
  }

  return cents
}

const save = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value))
}

const seedData = (kind: 'personal' | 'business'): DashboardStore => {
  const now = new Date()
  const make = (daysAgo: number, amountCents: number, category: Category, note: string): Expense => {
    const d = new Date(now)
    d.setDate(now.getDate() - daysAgo)
    return {
      id: `${kind}-${d.getTime()}-${category}`,
      amountCents,
      category,
      note,
      createdAt: d.toISOString(),
    }
  }

  return {
    expenses:
      kind === 'personal'
        ? [
            make(1, dollarsToCents(24), 'Food', 'Lunch'),
            make(2, dollarsToCents(18), 'Transport', 'Rideshare'),
            make(5, dollarsToCents(61), 'Shopping', 'Groceries'),
          ]
        : [
            make(0, dollarsToCents(145), 'Bills', 'Workspace software'),
            make(3, dollarsToCents(72), 'Transport', 'Client visit train'),
            make(8, dollarsToCents(34), 'Food', 'Team coffee'),
          ],
  }
}

const ensureStore = (key: string, fallback: DashboardStore) => {
  const existing = safeRead<DashboardStore | null>(key, null)
  if (!existing) {
    save(key, fallback)
    return fallback
  }
  const normalized: DashboardStore = {
    expenses: existing.expenses.map((expense) => {
      if (typeof expense.amountCents === 'number') {
        return expense
      }

      const legacyAmount = (expense as Expense & { amount?: number }).amount
      return {
        ...expense,
        amountCents: dollarsToCents(Number.isFinite(legacyAmount) ? legacyAmount ?? 0 : 0),
      }
    }),
  }
  save(key, normalized)
  return normalized
}

const donutBackground = (totals: Record<Category, number>) => {
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0)
  if (total <= 0) {
    return '#2b3443'
  }

  let progress = 0
  const stops = CATEGORIES.filter((category) => totals[category] > 0).map((category) => {
    const share = (totals[category] / total) * 100
    const start = progress
    const end = progress + share
    progress = end
    return `${CATEGORY_COLORS[category]} ${start}% ${end}%`
  })

  return `conic-gradient(${stops.join(', ')})`
}

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('personal')
  const [personal, setPersonal] = useState<DashboardStore>(() =>
    ensureStore(STORAGE_KEYS.personal, seedData('personal')),
  )
  const [business, setBusiness] = useState<DashboardStore>(() =>
    ensureStore(STORAGE_KEYS.business, seedData('business')),
  )
  const [notes, setNotes] = useState<string[]>(() => safeRead(STORAGE_KEYS.notes, []))

  const [showAdd, setShowAdd] = useState(false)
  const [amountInput, setAmountInput] = useState('')
  const [amountError, setAmountError] = useState('')
  const [categoryInput, setCategoryInput] = useState<Category>('Food')
  const [noteInput, setNoteInput] = useState('')
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const activeStore = activeTab === 'personal' ? personal : business
  const setActiveStore = activeTab === 'personal' ? setPersonal : setBusiness
  const activeStorageKey = activeTab === 'personal' ? STORAGE_KEYS.personal : STORAGE_KEYS.business

  const monthTotals = useMemo(() => {
    const baseline = Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<Category, number>
    const thisMonth = monthKey()

    for (const expense of activeStore.expenses) {
      if (monthKey(new Date(expense.createdAt)) === thisMonth) {
        baseline[expense.category] += expense.amountCents
      }
    }

    return baseline
  }, [activeStore.expenses])

  const monthlyTotal = Object.values(monthTotals).reduce((sum, value) => sum + value, 0)

  const recentTransactions = useMemo(
    () => [...activeStore.expenses].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [activeStore.expenses],
  )

  const addExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amountCents = parseCurrencyInputToCents(amountInput)
    if (!amountCents) {
      setAmountError('Enter a valid amount, like 3.99 or 3,99.')
      return
    }

    const nextExpense: Expense = {
      id: `${activeTab}-${Date.now()}`,
      amountCents,
      category: categoryInput,
      note: noteInput.trim() || 'Expense',
      createdAt: new Date().toISOString(),
    }

    const nextStore = {
      expenses: [nextExpense, ...activeStore.expenses],
    }

    setActiveStore(nextStore)
    save(activeStorageKey, nextStore)

    setAmountInput('')
    setAmountError('')
    setCategoryInput('Food')
    setNoteInput('')
    setShowAdd(false)
  }

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, select, button, label, form')) {
      touchStartRef.current = null
      return
    }

    const touch = event.changedTouches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    if (showAdd || !touchStartRef.current) {
      return
    }
    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - touchStartRef.current.x
    const deltaY = touch.clientY - touchStartRef.current.y
    touchStartRef.current = null

    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
      return
    }

    const currentIndex = TABS.indexOf(activeTab)
    if (deltaX < 0 && currentIndex < TABS.length - 1) {
      setActiveTab(TABS[currentIndex + 1])
    } else if (deltaX > 0 && currentIndex > 0) {
      setActiveTab(TABS[currentIndex - 1])
    }
  }

  const addNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!noteInput.trim()) {
      return
    }

    const next = [{ text: noteInput.trim(), at: new Date().toISOString() }, ...notes.map((text) => ({ text, at: '' }))]
      .slice(0, 80)
      .map((item) => item.text)

    setNotes(next)
    save(STORAGE_KEYS.notes, next)
    setNoteInput('')
  }

  return (
    <main className="app-shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="top-nav" role="tablist" aria-label="Account views">
        <button
          className={activeTab === 'personal' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('personal')}
          role="tab"
          aria-selected={activeTab === 'personal'}
        >
          Personal
        </button>
        <button
          className={activeTab === 'business' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('business')}
          role="tab"
          aria-selected={activeTab === 'business'}
        >
          Business
        </button>
        <button
          className={activeTab === 'notes' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('notes')}
          role="tab"
          aria-selected={activeTab === 'notes'}
        >
          Notes
        </button>
      </header>

      {activeTab === 'notes' ? (
        <section className="notes-page">
          <h1>Money Notes</h1>
          <p className="subtitle">Quick thoughts, reminders, and budgeting ideas.</p>
          <form className="note-form" onSubmit={addNote}>
            <textarea
              value={noteInput}
              onChange={(event) => setNoteInput(event.target.value)}
              placeholder="Write a quick note..."
              rows={4}
            />
            <button type="submit">Save Note</button>
          </form>
          <ul className="notes-list">
            {notes.length === 0 ? (
              <li className="empty">No notes yet. Add one above.</li>
            ) : (
              notes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)
            )}
          </ul>
        </section>
      ) : (
        <section className="dashboard">
          <h1>{activeTab === 'personal' ? 'Personal Dashboard' : 'Business Dashboard'}</h1>
          <p className="subtitle">Track month-to-date spending by category.</p>

          <div className="donut-wrap">
            <div className="donut" style={{ background: donutBackground(monthTotals) }} aria-label="Category spending chart">
              <div className="donut-center">
                <span>Total</span>
                <strong>{formatCents(monthlyTotal)}</strong>
              </div>
            </div>
            <ul className="legend">
              {CATEGORIES.map((category) => (
                <li key={category}>
                  <span className="dot" style={{ backgroundColor: CATEGORY_COLORS[category] }} />
                  <span>{category}</span>
                  <strong>{formatCents(monthTotals[category])}</strong>
                </li>
              ))}
            </ul>
          </div>

          <section className="transactions">
            <h2>Recent Transactions</h2>
            {recentTransactions.length === 0 ? (
              <p className="empty">No expenses yet. Tap + to add one.</p>
            ) : (
              <ul>
                {recentTransactions.map((expense) => (
                  <li key={expense.id}>
                    <div>
                      <p className="label">{expense.note}</p>
                      <p className="meta">
                        {expense.category} • {dateLabel.format(new Date(expense.createdAt))}
                      </p>
                    </div>
                    <strong>-{formatCents(expense.amountCents)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button className="fab" onClick={() => setShowAdd(true)} aria-label="Add expense">
            +
          </button>

          {showAdd ? (
            <div className="modal-backdrop" onClick={() => setShowAdd(false)}>
              <form
                className="expense-form"
                onSubmit={addExpense}
                onClick={(event) => event.stopPropagation()}
              >
                <h3>Add Expense</h3>
                <label>
                  Amount
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="45.00 or 45,00"
                    value={amountInput}
                    onChange={(event) => {
                      setAmountInput(event.target.value)
                      if (amountError) {
                        setAmountError('')
                      }
                    }}
                    required
                  />
                  {amountError ? <small className="field-error">{amountError}</small> : null}
                </label>
                <label>
                  Category
                  <select value={categoryInput} onChange={(event) => setCategoryInput(event.target.value as Category)}>
                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Note
                  <input
                    type="text"
                    placeholder="Groceries"
                    value={noteInput}
                    onChange={(event) => setNoteInput(event.target.value)}
                  />
                </label>
                <button type="submit">Save Expense</button>
              </form>
            </div>
          ) : null}
        </section>
      )}
    </main>
  )
}

export default App
