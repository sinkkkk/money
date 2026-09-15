import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

type TabId = 'personal' | 'business' | 'notes'
type Category = 'Food' | 'Transport' | 'Shopping' | 'Bills' | 'Health' | 'Other'

type Expense = {
  id: string
  amount: number
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
  maximumFractionDigits: 0,
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

const save = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value))
}

const seedData = (kind: 'personal' | 'business'): DashboardStore => {
  const now = new Date()
  const make = (daysAgo: number, amount: number, category: Category, note: string): Expense => {
    const d = new Date(now)
    d.setDate(now.getDate() - daysAgo)
    return {
      id: `${kind}-${d.getTime()}-${category}`,
      amount,
      category,
      note,
      createdAt: d.toISOString(),
    }
  }

  return {
    expenses:
      kind === 'personal'
        ? [
            make(1, 24, 'Food', 'Lunch'),
            make(2, 18, 'Transport', 'Rideshare'),
            make(5, 61, 'Shopping', 'Groceries'),
          ]
        : [
            make(0, 145, 'Bills', 'Workspace software'),
            make(3, 72, 'Transport', 'Client visit train'),
            make(8, 34, 'Food', 'Team coffee'),
          ],
  }
}

const ensureStore = (key: string, fallback: DashboardStore) => {
  const existing = safeRead<DashboardStore | null>(key, null)
  if (!existing) {
    save(key, fallback)
    return fallback
  }
  return existing
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
  const [categoryInput, setCategoryInput] = useState<Category>('Food')
  const [noteInput, setNoteInput] = useState('')

  const activeStore = activeTab === 'personal' ? personal : business
  const setActiveStore = activeTab === 'personal' ? setPersonal : setBusiness
  const activeStorageKey = activeTab === 'personal' ? STORAGE_KEYS.personal : STORAGE_KEYS.business

  const monthTotals = useMemo(() => {
    const baseline = Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<Category, number>
    const thisMonth = monthKey()

    for (const expense of activeStore.expenses) {
      if (monthKey(new Date(expense.createdAt)) === thisMonth) {
        baseline[expense.category] += expense.amount
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
    const amount = Number(amountInput)
    if (!Number.isFinite(amount) || amount <= 0) {
      return
    }

    const nextExpense: Expense = {
      id: `${activeTab}-${Date.now()}`,
      amount,
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
    setCategoryInput('Food')
    setNoteInput('')
    setShowAdd(false)
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
    <main className="app-shell">
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
                <strong>{currency.format(monthlyTotal)}</strong>
              </div>
            </div>
            <ul className="legend">
              {CATEGORIES.map((category) => (
                <li key={category}>
                  <span className="dot" style={{ backgroundColor: CATEGORY_COLORS[category] }} />
                  <span>{category}</span>
                  <strong>{currency.format(monthTotals[category])}</strong>
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
                    <strong>-{currency.format(expense.amount)}</strong>
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
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="45"
                    value={amountInput}
                    onChange={(event) => setAmountInput(event.target.value)}
                    required
                  />
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
