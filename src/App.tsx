import { useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, TouchEvent } from 'react'

type TabId = 'personal' | 'business' | 'notes' | 'settings'
type AccountKind = 'personal' | 'business'
type CurrencySymbol = '€' | '$'

type Expense = {
  id: string
  amountCents: number
  categoryId: string
  note: string
  createdAt: string
}

type CategoryItem = {
  id: string
  name: string
  color: string
}

type DashboardStore = {
  expenses: Expense[]
  categories: CategoryItem[]
}

type DashboardMetrics = {
  totalsByCategory: Record<string, number>
  monthlyTotalCents: number
  recentTransactions: Expense[]
}

type AppSettings = {
  currencySymbol: CurrencySymbol
}

const STORAGE_KEYS = {
  personal: 'money.pwa.personal.v2',
  business: 'money.pwa.business.v2',
  notes: 'money.pwa.notes.v1',
  settings: 'money.pwa.settings.v1',
} as const

const DEFAULT_CATEGORIES: CategoryItem[] = [
  { id: 'food', name: 'Food', color: '#58c7b3' },
  { id: 'transport', name: 'Transport', color: '#6a87ff' },
  { id: 'shopping', name: 'Shopping', color: '#9b7bff' },
  { id: 'bills', name: 'Bills', color: '#f3b878' },
  { id: 'health', name: 'Health', color: '#7dc8f8' },
  { id: 'other', name: 'Other', color: '#8493ab' },
]

const TABS: TabId[] = ['personal', 'business', 'notes', 'settings']

const TAB_LABELS: Record<TabId, string> = {
  personal: 'Personal',
  business: 'Business',
  notes: 'Notes',
  settings: 'Settings',
}

const SETTINGS_DEFAULT: AppSettings = {
  currencySymbol: '€',
}

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

const formatCents = (cents: number, symbol: CurrencySymbol) => {
  const absolute = Math.abs(cents) / 100
  const formatted = absolute.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${symbol}${formatted}`
}

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

const normalizeCategories = (input: unknown): CategoryItem[] => {
  if (!Array.isArray(input)) {
    return DEFAULT_CATEGORIES
  }

  const categories = input
    .filter((value): value is CategoryItem => {
      if (!value || typeof value !== 'object') {
        return false
      }
      const item = value as Partial<CategoryItem>
      return (
        typeof item.id === 'string' &&
        item.id.trim().length > 0 &&
        typeof item.name === 'string' &&
        item.name.trim().length > 0 &&
        typeof item.color === 'string' &&
        item.color.startsWith('#')
      )
    })
    .map((item) => ({
      id: item.id.trim().toLowerCase(),
      name: item.name.trim(),
      color: item.color,
    }))

  const unique = categories.filter((category, index) => categories.findIndex((it) => it.id === category.id) === index)
  return unique.length > 0 ? unique : DEFAULT_CATEGORIES
}

const legacyCategoryToId = (value: string): string => {
  const normalized = value.trim().toLowerCase()
  const mapped = DEFAULT_CATEGORIES.find((category) => category.name.toLowerCase() === normalized)
  return mapped?.id ?? 'other'
}

const seedData = (kind: AccountKind): DashboardStore => {
  const now = new Date()
  const make = (daysAgo: number, amountCents: number, categoryId: string, note: string): Expense => {
    const d = new Date(now)
    d.setDate(now.getDate() - daysAgo)
    return {
      id: `${kind}-${d.getTime()}-${categoryId}`,
      amountCents,
      categoryId,
      note,
      createdAt: d.toISOString(),
    }
  }

  return {
    categories: DEFAULT_CATEGORIES,
    expenses:
      kind === 'personal'
        ? [
            make(1, dollarsToCents(24), 'food', 'Lunch'),
            make(2, dollarsToCents(18), 'transport', 'Rideshare'),
            make(5, dollarsToCents(61), 'shopping', 'Groceries'),
          ]
        : [
            make(0, dollarsToCents(145), 'bills', 'Workspace software'),
            make(3, dollarsToCents(72), 'transport', 'Client visit train'),
            make(8, dollarsToCents(34), 'food', 'Team coffee'),
          ],
  }
}

const ensureStore = (key: string, fallback: DashboardStore) => {
  const existing = safeRead<Record<string, unknown> | null>(key, null)
  if (!existing) {
    save(key, fallback)
    return fallback
  }

  const categories = normalizeCategories(existing.categories)
  const fallbackCategoryId = categories.find((category) => category.id === 'other')?.id ?? categories[0].id

  const expensesSource = Array.isArray(existing.expenses) ? existing.expenses : []
  const normalizedExpenses: Expense[] = expensesSource
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    .map((expense) => {
      const amountCents =
        typeof expense.amountCents === 'number'
          ? Math.round(expense.amountCents)
          : typeof expense.amount === 'number'
            ? dollarsToCents(expense.amount)
            : 0

      const legacyCategory = typeof expense.category === 'string' ? legacyCategoryToId(expense.category) : null
      const categoryIdRaw = typeof expense.categoryId === 'string' ? expense.categoryId.trim().toLowerCase() : legacyCategory
      const categoryId = categories.some((category) => category.id === categoryIdRaw)
        ? (categoryIdRaw as string)
        : fallbackCategoryId

      return {
        id: typeof expense.id === 'string' ? expense.id : `expense-${Date.now()}-${Math.random()}`,
        amountCents: Number.isFinite(amountCents) ? Math.max(0, amountCents) : 0,
        categoryId,
        note: typeof expense.note === 'string' && expense.note.trim() ? expense.note.trim() : 'Expense',
        createdAt: typeof expense.createdAt === 'string' ? expense.createdAt : new Date().toISOString(),
      }
    })
    .filter((expense) => expense.amountCents > 0)

  const normalized: DashboardStore = {
    categories,
    expenses: normalizedExpenses,
  }

  save(key, normalized)
  return normalized
}

const ensureSettings = (): AppSettings => {
  const settings = safeRead<AppSettings | null>(STORAGE_KEYS.settings, null)
  if (!settings || (settings.currencySymbol !== '€' && settings.currencySymbol !== '$')) {
    save(STORAGE_KEYS.settings, SETTINGS_DEFAULT)
    return SETTINGS_DEFAULT
  }
  return settings
}

const buildDashboardMetrics = (store: DashboardStore): DashboardMetrics => {
  const totalsByCategory = Object.fromEntries(store.categories.map((category) => [category.id, 0])) as Record<string, number>
  const thisMonth = monthKey()

  for (const expense of store.expenses) {
    if (!(expense.categoryId in totalsByCategory)) {
      totalsByCategory[expense.categoryId] = 0
    }

    if (monthKey(new Date(expense.createdAt)) === thisMonth) {
      totalsByCategory[expense.categoryId] += expense.amountCents
    }
  }

  const monthlyTotalCents = Object.values(totalsByCategory).reduce((sum, value) => sum + value, 0)
  const recentTransactions = [...store.expenses].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

  return {
    totalsByCategory,
    monthlyTotalCents,
    recentTransactions,
  }
}

const donutBackground = (categories: CategoryItem[], totals: Record<string, number>) => {
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0)
  if (total <= 0) {
    return '#2b3443'
  }

  let progress = 0
  const stops = categories
    .filter((category) => (totals[category.id] ?? 0) > 0)
    .map((category) => {
      const share = ((totals[category.id] ?? 0) / total) * 100
      const start = progress
      const end = progress + share
      progress = end
      return `${category.color} ${start}% ${end}%`
    })

  return `conic-gradient(${stops.join(', ')})`
}

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('personal')
  const [personal, setPersonal] = useState<DashboardStore>(() => ensureStore(STORAGE_KEYS.personal, seedData('personal')))
  const [business, setBusiness] = useState<DashboardStore>(() => ensureStore(STORAGE_KEYS.business, seedData('business')))
  const [notes, setNotes] = useState<string[]>(() => safeRead(STORAGE_KEYS.notes, []))
  const [settings, setSettings] = useState<AppSettings>(() => ensureSettings())

  const [showExpenseEditor, setShowExpenseEditor] = useState(false)
  const [expenseEditId, setExpenseEditId] = useState<string | null>(null)
  const [amountInput, setAmountInput] = useState('')
  const [amountError, setAmountError] = useState('')
  const [categoryInput, setCategoryInput] = useState('food')
  const [expenseNoteInput, setExpenseNoteInput] = useState('')

  const [noteActionIndex, setNoteActionIndex] = useState<number | null>(null)
  const [transactionActionId, setTransactionActionId] = useState<string | null>(null)
  const [showNoteEditor, setShowNoteEditor] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')

  const [moneyNoteInput, setMoneyNoteInput] = useState('')
  const [settingsAccount, setSettingsAccount] = useState<AccountKind>('personal')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState('#6a87ff')

  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const longPressTimerRef = useRef<number | null>(null)

  const personalMetrics = useMemo(() => buildDashboardMetrics(personal), [personal])
  const businessMetrics = useMemo(() => buildDashboardMetrics(business), [business])

  const activeTabIndex = Math.max(0, TABS.indexOf(activeTab))
  const trackTranslatePercent = (activeTabIndex * 100) / TABS.length
  const pageViewportStyle = { '--page-count': TABS.length } as CSSProperties
  const pageTrackStyle = { transform: `translate3d(-${trackTranslatePercent}%, 0, 0)` }

  const activeDashboardStore = activeTab === 'business' ? business : personal
  const activeDashboardStorageKey = activeTab === 'business' ? STORAGE_KEYS.business : STORAGE_KEYS.personal

  const saveSettings = (next: AppSettings) => {
    setSettings(next)
    save(STORAGE_KEYS.settings, next)
  }

  const updateAccountStore = (account: AccountKind, updater: (store: DashboardStore) => DashboardStore) => {
    if (account === 'personal') {
      setPersonal((prev) => {
        const next = updater(prev)
        save(STORAGE_KEYS.personal, next)
        return next
      })
      return
    }

    setBusiness((prev) => {
      const next = updater(prev)
      save(STORAGE_KEYS.business, next)
      return next
    })
  }

  const switchTab = (tab: TabId) => {
    setActiveTab(tab)
    setShowExpenseEditor(false)
    setTransactionActionId(null)
    setNoteActionIndex(null)
  }

  const openAddExpense = () => {
    if (activeTab !== 'personal' && activeTab !== 'business') {
      return
    }

    const firstCategory = activeDashboardStore.categories[0]?.id ?? 'other'
    setExpenseEditId(null)
    setAmountInput('')
    setAmountError('')
    setCategoryInput(firstCategory)
    setExpenseNoteInput('')
    setShowExpenseEditor(true)
  }

  const openEditExpense = (expense: Expense) => {
    setExpenseEditId(expense.id)
    setAmountInput((expense.amountCents / 100).toFixed(2))
    setAmountError('')
    setCategoryInput(expense.categoryId)
    setExpenseNoteInput(expense.note)
    setShowExpenseEditor(true)
    setTransactionActionId(null)
  }

  const submitExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (activeTab !== 'personal' && activeTab !== 'business') {
      return
    }

    const amountCents = parseCurrencyInputToCents(amountInput)
    if (!amountCents) {
      setAmountError('Enter a valid amount, like 3.99 or 3,99.')
      return
    }

    const validCategoryId = activeDashboardStore.categories.some((category) => category.id === categoryInput)
      ? categoryInput
      : activeDashboardStore.categories[0]?.id ?? 'other'

    const nextExpense: Expense = {
      id: expenseEditId ?? `${activeTab}-${Date.now()}`,
      amountCents,
      categoryId: validCategoryId,
      note: expenseNoteInput.trim() || 'Expense',
      createdAt: expenseEditId
        ? activeDashboardStore.expenses.find((expense) => expense.id === expenseEditId)?.createdAt ?? new Date().toISOString()
        : new Date().toISOString(),
    }

    const nextStore: DashboardStore = {
      ...activeDashboardStore,
      expenses: expenseEditId
        ? activeDashboardStore.expenses.map((expense) => (expense.id === expenseEditId ? nextExpense : expense))
        : [nextExpense, ...activeDashboardStore.expenses],
    }

    if (activeTab === 'personal') {
      setPersonal(nextStore)
    } else {
      setBusiness(nextStore)
    }

    save(activeDashboardStorageKey, nextStore)

    setShowExpenseEditor(false)
    setExpenseEditId(null)
    setAmountInput('')
    setAmountError('')
    setExpenseNoteInput('')
  }

  const deleteExpense = (expenseId: string) => {
    if (activeTab !== 'personal' && activeTab !== 'business') {
      return
    }

    const nextStore: DashboardStore = {
      ...activeDashboardStore,
      expenses: activeDashboardStore.expenses.filter((expense) => expense.id !== expenseId),
    }

    if (activeTab === 'personal') {
      setPersonal(nextStore)
    } else {
      setBusiness(nextStore)
    }

    save(activeDashboardStorageKey, nextStore)
    setTransactionActionId(null)
  }

  const addNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!moneyNoteInput.trim()) {
      return
    }

    const next = [moneyNoteInput.trim(), ...notes].slice(0, 80)
    setNotes(next)
    save(STORAGE_KEYS.notes, next)
    setMoneyNoteInput('')
  }

  const saveEditedNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (noteActionIndex === null || !noteDraft.trim()) {
      return
    }

    const next = notes.map((note, index) => (index === noteActionIndex ? noteDraft.trim() : note))
    setNotes(next)
    save(STORAGE_KEYS.notes, next)
    setShowNoteEditor(false)
    setNoteActionIndex(null)
    setNoteDraft('')
  }

  const deleteNote = (index: number) => {
    const next = notes.filter((_, noteIndex) => noteIndex !== index)
    setNotes(next)
    save(STORAGE_KEYS.notes, next)
    setNoteActionIndex(null)
  }

  const startLongPress = (callback: () => void) => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
    }

    longPressTimerRef.current = window.setTimeout(() => {
      callback()
      longPressTimerRef.current = null
    }, 450)
  }

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
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
    if (showExpenseEditor || showNoteEditor || !touchStartRef.current) {
      return
    }

    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - touchStartRef.current.x
    const deltaY = touch.clientY - touchStartRef.current.y
    touchStartRef.current = null

    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
      return
    }

    if (deltaX < 0 && activeTabIndex < TABS.length - 1) {
      switchTab(TABS[activeTabIndex + 1])
    }

    if (deltaX > 0 && activeTabIndex > 0) {
      switchTab(TABS[activeTabIndex - 1])
    }
  }

  const manageCategoriesStore = settingsAccount === 'personal' ? personal : business

  const addCategory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = newCategoryName.trim()
    if (!name) {
      return
    }

    const idBase = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const safeBase = idBase.length > 0 ? idBase : 'category'
    const uniqueId = `${safeBase}-${Date.now().toString(36).slice(-4)}`

    updateAccountStore(settingsAccount, (store) => ({
      ...store,
      categories: [...store.categories, { id: uniqueId, name, color: newCategoryColor }],
    }))

    setNewCategoryName('')
  }

  const updateCategory = (account: AccountKind, categoryId: string, patch: Partial<CategoryItem>) => {
    updateAccountStore(account, (store) => ({
      ...store,
      categories: store.categories.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              ...patch,
              name: patch.name?.trim() ? patch.name.trim() : category.name,
            }
          : category,
      ),
    }))
  }

  const removeCategory = (account: AccountKind, categoryId: string) => {
    updateAccountStore(account, (store) => {
      if (store.categories.length <= 1) {
        return store
      }

      const remaining = store.categories.filter((category) => category.id !== categoryId)
      const fallbackCategoryId = remaining.find((category) => category.id === 'other')?.id ?? remaining[0].id

      return {
        categories: remaining,
        expenses: store.expenses.map((expense) =>
          expense.categoryId === categoryId ? { ...expense, categoryId: fallbackCategoryId } : expense,
        ),
      }
    })

    if (categoryInput === categoryId) {
      const nextStore = account === 'personal' ? personal : business
      const fallback = nextStore.categories.find((category) => category.id !== categoryId)?.id
      if (fallback) {
        setCategoryInput(fallback)
      }
    }
  }

  const renderDashboardPage = (account: AccountKind, title: string, store: DashboardStore, metrics: DashboardMetrics) => (
    <section className="dashboard page" key={account}>
      <h1>{title}</h1>
      <p className="subtitle">Track month-to-date spending by category.</p>

      <div className="donut-wrap">
        <div className="donut" style={{ background: donutBackground(store.categories, metrics.totalsByCategory) }} aria-label="Category spending chart">
          <div className="donut-center">
            <span>Total</span>
            <strong>{formatCents(metrics.monthlyTotalCents, settings.currencySymbol)}</strong>
          </div>
        </div>
        <ul className="legend">
          {store.categories.map((category) => (
            <li key={category.id}>
              <span className="dot" style={{ backgroundColor: category.color }} />
              <span>{category.name}</span>
              <strong>{formatCents(metrics.totalsByCategory[category.id] ?? 0, settings.currencySymbol)}</strong>
            </li>
          ))}
        </ul>
      </div>

      <section className="transactions">
        <h2>Recent Transactions</h2>
        {metrics.recentTransactions.length === 0 ? (
          <p className="empty">No expenses yet. Tap + to add one.</p>
        ) : (
          <ul>
            {metrics.recentTransactions.map((expense) => {
              const categoryName = store.categories.find((category) => category.id === expense.categoryId)?.name ?? 'Other'
              return (
                <li
                  key={expense.id}
                  onTouchStart={() => startLongPress(() => setTransactionActionId(expense.id))}
                  onTouchEnd={clearLongPress}
                  onTouchCancel={clearLongPress}
                  onMouseDown={() => startLongPress(() => setTransactionActionId(expense.id))}
                  onMouseUp={clearLongPress}
                  onMouseLeave={clearLongPress}
                >
                  <div>
                    <p className="label">{expense.note}</p>
                    <p className="meta">
                      {categoryName} • {dateLabel.format(new Date(expense.createdAt))}
                    </p>
                  </div>
                  <strong className="expense-outflow">-{formatCents(expense.amountCents, settings.currencySymbol)}</strong>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </section>
  )

  return (
    <main className="app-shell">
      <header className="top-nav" role="tablist" aria-label="Account views">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? 'tab active' : 'tab'}
            onClick={() => switchTab(tab)}
            role="tab"
            aria-selected={activeTab === tab}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </header>

      <div className="page-viewport" style={pageViewportStyle} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="page-track" style={pageTrackStyle}>
          {renderDashboardPage('personal', 'Personal Dashboard', personal, personalMetrics)}
          {renderDashboardPage('business', 'Business Dashboard', business, businessMetrics)}

          <section className="notes-page page">
            <h1>Money Notes</h1>
            <p className="subtitle">Tap and hold a note for edit/delete actions.</p>
            <form className="note-form" onSubmit={addNote}>
              <textarea
                value={moneyNoteInput}
                onChange={(event) => setMoneyNoteInput(event.target.value)}
                placeholder="Write a quick note..."
                rows={4}
              />
              <button type="submit">Save Note</button>
            </form>
            <ul className="notes-list">
              {notes.length === 0 ? (
                <li className="empty">No notes yet. Add one above.</li>
              ) : (
                notes.map((note, index) => (
                  <li
                    key={`${note}-${index}`}
                    onTouchStart={() => startLongPress(() => setNoteActionIndex(index))}
                    onTouchEnd={clearLongPress}
                    onTouchCancel={clearLongPress}
                    onMouseDown={() => startLongPress(() => setNoteActionIndex(index))}
                    onMouseUp={clearLongPress}
                    onMouseLeave={clearLongPress}
                  >
                    {note}
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="settings-page page">
            <h1>Settings</h1>
            <p className="subtitle">Customize categories and currency preferences.</p>

            <section className="settings-card">
              <h2>Currency Symbol</h2>
              <div className="chip-row">
                {(['€', '$'] as CurrencySymbol[]).map((symbol) => (
                  <button
                    key={symbol}
                    type="button"
                    className={settings.currencySymbol === symbol ? 'chip active' : 'chip'}
                    onClick={() => saveSettings({ currencySymbol: symbol })}
                  >
                    {symbol}
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-card">
              <h2>Category Management</h2>
              <div className="chip-row account-switch">
                {(['personal', 'business'] as AccountKind[]).map((account) => (
                  <button
                    key={account}
                    type="button"
                    className={settingsAccount === account ? 'chip active' : 'chip'}
                    onClick={() => setSettingsAccount(account)}
                  >
                    {account === 'personal' ? 'Personal' : 'Business'}
                  </button>
                ))}
              </div>

              <ul className="category-list">
                {manageCategoriesStore.categories.map((category) => (
                  <li key={category.id}>
                    <input
                      type="color"
                      aria-label={`Color for ${category.name}`}
                      value={category.color}
                      onChange={(event) => updateCategory(settingsAccount, category.id, { color: event.target.value })}
                    />
                    <input
                      type="text"
                      value={category.name}
                      onChange={(event) => updateCategory(settingsAccount, category.id, { name: event.target.value })}
                    />
                    <button type="button" className="danger-button" onClick={() => removeCategory(settingsAccount, category.id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>

              <form className="inline-form" onSubmit={addCategory}>
                <input
                  type="text"
                  placeholder="New category"
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                />
                <input
                  type="color"
                  value={newCategoryColor}
                  onChange={(event) => setNewCategoryColor(event.target.value)}
                  aria-label="New category color"
                />
                <button type="submit">Add</button>
              </form>
            </section>
          </section>
        </div>
      </div>

      {(activeTab === 'personal' || activeTab === 'business') && !showExpenseEditor ? (
        <button className="fab" onClick={openAddExpense} aria-label="Add expense">
          +
        </button>
      ) : null}

      {showExpenseEditor ? (
        <div className="modal-backdrop" onClick={() => setShowExpenseEditor(false)}>
          <form className="expense-form" onSubmit={submitExpense} onClick={(event) => event.stopPropagation()}>
            <h3>{expenseEditId ? 'Edit Expense' : 'Add Expense'}</h3>
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
              <select value={categoryInput} onChange={(event) => setCategoryInput(event.target.value)}>
                {activeDashboardStore.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note
              <input
                type="text"
                placeholder="Groceries"
                value={expenseNoteInput}
                onChange={(event) => setExpenseNoteInput(event.target.value)}
              />
            </label>
            <button type="submit">{expenseEditId ? 'Save Changes' : 'Save Expense'}</button>
          </form>
        </div>
      ) : null}

      {transactionActionId ? (
        <div className="action-sheet-backdrop" onClick={() => setTransactionActionId(null)}>
          <div className="action-sheet" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => {
                const target = activeDashboardStore.expenses.find((expense) => expense.id === transactionActionId)
                if (target) {
                  openEditExpense(target)
                }
              }}
            >
              Edit Transaction
            </button>
            <button type="button" className="danger-button" onClick={() => deleteExpense(transactionActionId)}>
              Delete Transaction
            </button>
            <button type="button" onClick={() => setTransactionActionId(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {noteActionIndex !== null && !showNoteEditor ? (
        <div className="action-sheet-backdrop" onClick={() => setNoteActionIndex(null)}>
          <div className="action-sheet" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => {
                setNoteDraft(notes[noteActionIndex] ?? '')
                setShowNoteEditor(true)
              }}
            >
              Edit Note
            </button>
            <button type="button" className="danger-button" onClick={() => deleteNote(noteActionIndex)}>
              Delete Note
            </button>
            <button type="button" onClick={() => setNoteActionIndex(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {showNoteEditor ? (
        <div className="modal-backdrop" onClick={() => setShowNoteEditor(false)}>
          <form className="expense-form" onSubmit={saveEditedNote} onClick={(event) => event.stopPropagation()}>
            <h3>Edit Note</h3>
            <label>
              Note
              <textarea value={noteDraft} rows={4} onChange={(event) => setNoteDraft(event.target.value)} required />
            </label>
            <button type="submit">Save Note</button>
          </form>
        </div>
      ) : null}
    </main>
  )
}

export default App
