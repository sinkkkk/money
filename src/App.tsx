import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent, FormEvent, TouchEvent } from 'react'

type TabId = 'personal' | 'business' | 'stats' | 'notes' | 'settings'
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
  monthlyTargetCents: number | null
  showBusiness: boolean
  showNotes: boolean
}

type StatsDayPoint = {
  label: string
  amountCents: number
}

type StatsMonthPoint = {
  label: string
  amountCents: number
  monthKey: string
}

type BackupPayload = {
  schemaVersion: 1
  exportedAt: string
  data: {
    personal: DashboardStore
    business: DashboardStore
    notes: string[]
    settings: AppSettings
    selectedMonthByAccount: Record<AccountKind, string>
  }
}

const STORAGE_KEYS = {
  personal: 'money.pwa.personal.v2',
  business: 'money.pwa.business.v2',
  notes: 'money.pwa.notes.v1',
  settings: 'money.pwa.settings.v1',
} as const

const BACKUP_SCHEMA_VERSION = 1

const DEFAULT_CATEGORIES: CategoryItem[] = [
  { id: 'food', name: 'Food', color: '#58c7b3' },
  { id: 'transport', name: 'Transport', color: '#6a87ff' },
  { id: 'shopping', name: 'Shopping', color: '#9b7bff' },
  { id: 'bills', name: 'Bills', color: '#f3b878' },
  { id: 'health', name: 'Health', color: '#7dc8f8' },
  { id: 'other', name: 'Other', color: '#8493ab' },
]

const ALL_TABS: TabId[] = ['personal', 'business', 'stats', 'notes', 'settings']

const TAB_LABELS: Record<TabId, string> = {
  personal: 'Personal',
  business: 'Business',
  stats: 'Stats',
  notes: 'Notes',
  settings: 'Settings',
}

const SETTINGS_DEFAULT: AppSettings = {
  currencySymbol: '€',
  monthlyTargetCents: null,
  showBusiness: true,
  showNotes: true,
}

const dateLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
})

const dayLabel = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
})

const monthLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short',
})

const monthSelectLabel = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
})

const monthKey = (date = new Date()) => `${date.getFullYear()}-${date.getMonth()}`

const monthFromKey = (key: string) => {
  const [yearRaw, monthRaw] = key.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  return new Date(year, month, 1)
}

const dayKey = (date = new Date()) => {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

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
  const settings = safeRead<Partial<AppSettings> | null>(STORAGE_KEYS.settings, null)
  if (!settings) {
    save(STORAGE_KEYS.settings, SETTINGS_DEFAULT)
    return SETTINGS_DEFAULT
  }

  const currencySymbol = settings.currencySymbol === '$' ? '$' : '€'
  const monthlyTargetCents =
    typeof settings.monthlyTargetCents === 'number' && Number.isFinite(settings.monthlyTargetCents)
      ? Math.round(settings.monthlyTargetCents)
      : null

  const normalized: AppSettings = {
    currencySymbol,
    monthlyTargetCents,
    showBusiness: settings.showBusiness !== false,
    showNotes: settings.showNotes !== false,
  }
  save(STORAGE_KEYS.settings, normalized)
  return normalized
}

const buildDashboardMetrics = (store: DashboardStore, selectedMonth: string): DashboardMetrics => {
  const totalsByCategory = Object.fromEntries(store.categories.map((category) => [category.id, 0])) as Record<string, number>

  for (const expense of store.expenses) {
    if (!(expense.categoryId in totalsByCategory)) {
      totalsByCategory[expense.categoryId] = 0
    }

    if (monthKey(new Date(expense.createdAt)) === selectedMonth) {
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

const buildMonthOptions = (expenses: Expense[]) => {
  const current = monthKey(new Date())
  const keys = new Set<string>([current])
  for (const expense of expenses) {
    keys.add(monthKey(new Date(expense.createdAt)))
  }

  return [...keys]
    .sort((a, b) => monthFromKey(b).getTime() - monthFromKey(a).getTime())
    .map((key) => ({
      value: key,
      label: monthSelectLabel.format(monthFromKey(key)),
    }))
}

const getVisibleTabsFromFlags = (showBusiness: boolean, showNotes: boolean): TabId[] => {
  const tabs: TabId[] = ['personal']
  if (showBusiness) {
    tabs.push('business')
  }
  tabs.push('stats')
  if (showNotes) {
    tabs.push('notes')
  }
  tabs.push('settings')
  return tabs
}

const findNearestVisibleTab = (tab: TabId, visibleTabs: TabId[]) => {
  if (visibleTabs.includes(tab)) {
    return tab
  }

  const hiddenIndex = ALL_TABS.indexOf(tab)
  for (let offset = 1; offset < ALL_TABS.length; offset += 1) {
    const left = ALL_TABS[hiddenIndex - offset]
    if (left && visibleTabs.includes(left)) {
      return left
    }
    const right = ALL_TABS[hiddenIndex + offset]
    if (right && visibleTabs.includes(right)) {
      return right
    }
  }
  return visibleTabs[0] ?? 'personal'
}

const normalizeStoreFromUnknown = (raw: unknown, fallback: DashboardStore): DashboardStore => {
  if (!raw || typeof raw !== 'object') {
    return fallback
  }

  const candidate = raw as Record<string, unknown>
  const categories = normalizeCategories(candidate.categories)
  const fallbackCategoryId = categories.find((category) => category.id === 'other')?.id ?? categories[0].id
  const expensesSource = Array.isArray(candidate.expenses) ? candidate.expenses : []

  const expenses: Expense[] = expensesSource
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    .map((expense) => {
      const categoryRaw = typeof expense.categoryId === 'string' ? expense.categoryId.trim().toLowerCase() : fallbackCategoryId
      const categoryId = categories.some((category) => category.id === categoryRaw) ? categoryRaw : fallbackCategoryId
      const amountCents = typeof expense.amountCents === 'number' ? Math.round(expense.amountCents) : 0
      return {
        id: typeof expense.id === 'string' ? expense.id : `expense-${Date.now()}-${Math.random()}`,
        amountCents: Number.isFinite(amountCents) ? Math.max(0, amountCents) : 0,
        categoryId,
        note: typeof expense.note === 'string' && expense.note.trim() ? expense.note.trim() : 'Expense',
        createdAt: typeof expense.createdAt === 'string' ? expense.createdAt : new Date().toISOString(),
      }
    })
    .filter((expense) => expense.amountCents > 0)

  return {
    categories,
    expenses,
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

const summarizeComparison = (current: number, previous: number, symbol: CurrencySymbol, periodLabel: string) => {
  if (current === 0 && previous === 0) {
    return `You spent ${formatCents(0, symbol)} ${periodLabel} and the period before.`
  }

  if (previous === 0) {
    return `You spent ${formatCents(current, symbol)} ${periodLabel}, up from ${formatCents(0, symbol)} before.`
  }

  const ratio = ((current - previous) / previous) * 100
  const percent = Math.abs(ratio).toFixed(0)
  const direction = ratio <= 0 ? 'less' : 'more'
  return `You spent ${percent}% ${direction} ${periodLabel}.`
}

const buildStatsSeries = (expenses: Expense[]) => {
  const byDay: Record<string, number> = {}
  for (const expense of expenses) {
    const key = dayKey(new Date(expense.createdAt))
    byDay[key] = (byDay[key] ?? 0) + expense.amountCents
  }

  const today = new Date()
  const daily: StatsDayPoint[] = []
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    daily.push({ label: dayLabel.format(d), amountCents: byDay[dayKey(d)] ?? 0 })
  }

  const todaySpend = daily[daily.length - 1]?.amountCents ?? 0
  const yesterdaySpend = daily[daily.length - 2]?.amountCents ?? 0

  const monthly: StatsMonthPoint[] = []
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const key = monthKey(d)
    let total = 0
    for (const expense of expenses) {
      if (monthKey(new Date(expense.createdAt)) === key) {
        total += expense.amountCents
      }
    }
    monthly.push({ label: monthLabel.format(d), amountCents: total, monthKey: key })
  }

  const thisMonthSpend = monthly[monthly.length - 1]?.amountCents ?? 0
  const prevMonthSpend = monthly[monthly.length - 2]?.amountCents ?? 0

  return {
    daily,
    monthly,
    todaySpend,
    yesterdaySpend,
    thisMonthSpend,
    prevMonthSpend,
  }
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
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [showImportConfirm, setShowImportConfirm] = useState(false)
  const [backupMessage, setBackupMessage] = useState('')
  const [pendingBackupImport, setPendingBackupImport] = useState<BackupPayload | null>(null)
  const [targetInput, setTargetInput] = useState(() => {
    const initialSettings = ensureSettings()
    return initialSettings.monthlyTargetCents ? (initialSettings.monthlyTargetCents / 100).toFixed(2) : ''
  })
  const [selectedMonthByAccount, setSelectedMonthByAccount] = useState<Record<AccountKind, string>>({
    personal: monthKey(new Date()),
    business: monthKey(new Date()),
  })

  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const amountInputRef = useRef<HTMLInputElement | null>(null)
  const backupInputRef = useRef<HTMLInputElement | null>(null)

  const personalMonthOptions = useMemo(() => buildMonthOptions(personal.expenses), [personal.expenses])
  const businessMonthOptions = useMemo(() => buildMonthOptions(business.expenses), [business.expenses])
  const personalSelectedMonth = personalMonthOptions.some((option) => option.value === selectedMonthByAccount.personal)
    ? selectedMonthByAccount.personal
    : (personalMonthOptions[0]?.value ?? monthKey(new Date()))
  const businessSelectedMonth = businessMonthOptions.some((option) => option.value === selectedMonthByAccount.business)
    ? selectedMonthByAccount.business
    : (businessMonthOptions[0]?.value ?? monthKey(new Date()))
  const personalMetrics = useMemo(
    () => buildDashboardMetrics(personal, personalSelectedMonth),
    [personal, personalSelectedMonth],
  )
  const businessMetrics = useMemo(
    () => buildDashboardMetrics(business, businessSelectedMonth),
    [business, businessSelectedMonth],
  )
  const statsSeries = useMemo(() => buildStatsSeries(personal.expenses), [personal.expenses])
  const visibleTabs = useMemo<TabId[]>(
    () => getVisibleTabsFromFlags(settings.showBusiness, settings.showNotes),
    [settings.showBusiness, settings.showNotes],
  )
  const effectiveActiveTab = findNearestVisibleTab(activeTab, visibleTabs)

  const activeTabIndex = visibleTabs.indexOf(effectiveActiveTab)
  const safeActiveTabIndex = Math.max(0, activeTabIndex)
  const trackTranslatePercent = (safeActiveTabIndex * 100) / visibleTabs.length
  const pageViewportStyle = { '--page-count': visibleTabs.length } as CSSProperties
  const tabNavStyle = { '--tab-count': visibleTabs.length } as CSSProperties
  const pageTrackStyle = { transform: `translate3d(-${trackTranslatePercent}%, 0, 0)` }

  const activeDashboardStore = effectiveActiveTab === 'business' ? business : personal
  const activeDashboardStorageKey = effectiveActiveTab === 'business' ? STORAGE_KEYS.business : STORAGE_KEYS.personal

  const saveSettings = (next: Partial<AppSettings>) => {
    setSettings((prev) => {
      const merged = { ...prev, ...next }
      save(STORAGE_KEYS.settings, merged)
      return merged
    })
  }

  const toggleBusinessVisibility = () => {
    const nextShowBusiness = !settings.showBusiness
    const nextVisible = getVisibleTabsFromFlags(nextShowBusiness, settings.showNotes)
    setActiveTab((prev) => findNearestVisibleTab(prev, nextVisible))
    saveSettings({ showBusiness: nextShowBusiness })
  }

  const toggleNotesVisibility = () => {
    const nextShowNotes = !settings.showNotes
    const nextVisible = getVisibleTabsFromFlags(settings.showBusiness, nextShowNotes)
    setActiveTab((prev) => findNearestVisibleTab(prev, nextVisible))
    saveSettings({ showNotes: nextShowNotes })
  }

  const currentMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const currentMonthKey = monthKey(currentMonthStart)
  const currentMonthSpend = personal.expenses.reduce((sum, expense) => {
    if (monthKey(new Date(expense.createdAt)) !== currentMonthKey) {
      return sum
    }
    return sum + expense.amountCents
  }, 0)
  const daysInCurrentMonth = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() + 1, 0).getDate()
  const remainingDays = Math.max(daysInCurrentMonth - new Date().getDate() + 1, 1)
  const targetCents = settings.monthlyTargetCents
  const remainingBudgetCents = targetCents === null ? null : targetCents - currentMonthSpend
  const dailyAllowanceCents =
    remainingBudgetCents === null ? null : Math.trunc(remainingBudgetCents / Math.max(remainingDays, 1))

  const exportBackup = () => {
    const payload: BackupPayload = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        personal,
        business,
        notes,
        settings,
        selectedMonthByAccount: {
          personal: personalSelectedMonth,
          business: businessSelectedMonth,
        },
      },
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    anchor.href = url
    anchor.download = `money-dash-backup-${stamp}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setBackupMessage('Backup file exported. Save it to Files or iCloud Drive.')
  }

  const requestImportBackup = () => {
    backupInputRef.current?.click()
  }

  const onBackupFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as Partial<BackupPayload>
      if (parsed.schemaVersion !== BACKUP_SCHEMA_VERSION || !parsed.data) {
        setBackupMessage('Unsupported backup format. Use a Money Dash backup file.')
        return
      }
      const data = parsed.data as BackupPayload['data']
      const normalizedSettings: AppSettings = {
        currencySymbol: data.settings?.currencySymbol === '$' ? '$' : '€',
        monthlyTargetCents:
          typeof data.settings?.monthlyTargetCents === 'number' && Number.isFinite(data.settings.monthlyTargetCents)
            ? Math.round(data.settings.monthlyTargetCents)
            : null,
        showBusiness: data.settings?.showBusiness !== false,
        showNotes: data.settings?.showNotes !== false,
      }
      const prepared: BackupPayload = {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: parsed.exportedAt ?? new Date().toISOString(),
        data: {
          personal: normalizeStoreFromUnknown(data.personal, seedData('personal')),
          business: normalizeStoreFromUnknown(data.business, seedData('business')),
          notes: Array.isArray(data.notes) ? data.notes.filter((note) => typeof note === 'string') : [],
          settings: normalizedSettings,
          selectedMonthByAccount: {
            personal:
              typeof data.selectedMonthByAccount?.personal === 'string'
                ? data.selectedMonthByAccount.personal
                : monthKey(new Date()),
            business:
              typeof data.selectedMonthByAccount?.business === 'string'
                ? data.selectedMonthByAccount.business
                : monthKey(new Date()),
          },
        },
      }
      setPendingBackupImport(prepared)
      setShowImportConfirm(true)
      setBackupMessage('Backup loaded. Confirm import to overwrite current app data.')
    } catch {
      setBackupMessage('Could not read that file. Please select a valid backup JSON.')
    } finally {
      event.target.value = ''
    }
  }

  const confirmImportBackup = () => {
    if (!pendingBackupImport) {
      return
    }
    const next = pendingBackupImport.data
    setPersonal(next.personal)
    setBusiness(next.business)
    setNotes(next.notes)
    setSettings(next.settings)
    setSelectedMonthByAccount(next.selectedMonthByAccount)
    setActiveTab((prev) => findNearestVisibleTab(prev, getVisibleTabsFromFlags(next.settings.showBusiness, next.settings.showNotes)))
    setTargetInput(next.settings.monthlyTargetCents ? (next.settings.monthlyTargetCents / 100).toFixed(2) : '')
    save(STORAGE_KEYS.personal, next.personal)
    save(STORAGE_KEYS.business, next.business)
    save(STORAGE_KEYS.notes, next.notes)
    save(STORAGE_KEYS.settings, next.settings)
    setPendingBackupImport(null)
    setShowImportConfirm(false)
    setBackupMessage('Backup imported successfully.')
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
    setConfirmClearOpen(false)
  }

  const openAddExpense = () => {
    if (effectiveActiveTab !== 'personal' && effectiveActiveTab !== 'business') {
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
    if (effectiveActiveTab !== 'personal' && effectiveActiveTab !== 'business') {
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
      id: expenseEditId ?? `${effectiveActiveTab}-${Date.now()}`,
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

    if (effectiveActiveTab === 'personal') {
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
    if (effectiveActiveTab !== 'personal' && effectiveActiveTab !== 'business') {
      return
    }

    const nextStore: DashboardStore = {
      ...activeDashboardStore,
      expenses: activeDashboardStore.expenses.filter((expense) => expense.id !== expenseId),
    }

    if (effectiveActiveTab === 'personal') {
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

  const clearSpendingData = () => {
    const nextPersonal = { ...personal, expenses: [] }
    const nextBusiness = { ...business, expenses: [] }

    setPersonal(nextPersonal)
    setBusiness(nextBusiness)
    save(STORAGE_KEYS.personal, nextPersonal)
    save(STORAGE_KEYS.business, nextBusiness)
    setConfirmClearOpen(false)
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
    if (showExpenseEditor || showNoteEditor || confirmClearOpen || !touchStartRef.current) {
      return
    }

    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - touchStartRef.current.x
    const deltaY = touch.clientY - touchStartRef.current.y
    touchStartRef.current = null

    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
      return
    }

    if (deltaX < 0 && safeActiveTabIndex < visibleTabs.length - 1) {
      switchTab(visibleTabs[safeActiveTabIndex + 1])
    }

    if (deltaX > 0 && safeActiveTabIndex > 0) {
      switchTab(visibleTabs[safeActiveTabIndex - 1])
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

  const renderDashboardPage = (
    account: AccountKind,
    title: string,
    store: DashboardStore,
    metrics: DashboardMetrics,
    monthOptions: { value: string; label: string }[],
  ) => (
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

      <label className="month-picker month-picker-bottom">
        <span>Viewing Month</span>
        <select
          value={account === 'personal' ? personalSelectedMonth : businessSelectedMonth}
          onChange={(event) =>
            setSelectedMonthByAccount((prev) => ({
              ...prev,
              [account]: event.target.value,
            }))
          }
        >
          {monthOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  )

  const maxDaily = Math.max(...statsSeries.daily.map((item) => item.amountCents), 1)
  const maxMonthly = Math.max(...statsSeries.monthly.map((item) => item.amountCents), 1)
  const dailyPoints = statsSeries.daily
    .map((point, index) => {
      const x = (index / Math.max(statsSeries.daily.length - 1, 1)) * 100
      const y = 100 - (point.amountCents / maxDaily) * 100
      return `${x},${y}`
    })
    .join(' ')

  useEffect(() => {
    if (!showExpenseEditor) {
      return
    }

    const timer = window.setTimeout(() => {
      const input = amountInputRef.current
      if (!input) {
        return
      }
      input.focus()
      input.select()
    }, 40)

    return () => window.clearTimeout(timer)
  }, [showExpenseEditor, expenseEditId])

  return (
    <main className="app-shell">
      <header className="top-nav" role="tablist" aria-label="Account views" style={tabNavStyle}>
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            className={effectiveActiveTab === tab ? 'tab active' : 'tab'}
            onClick={() => switchTab(tab)}
            role="tab"
            aria-selected={effectiveActiveTab === tab}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </header>

      <div className="page-viewport" style={pageViewportStyle} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="page-track" style={pageTrackStyle}>
          {renderDashboardPage('personal', 'Personal Dashboard', personal, personalMetrics, personalMonthOptions)}
          {settings.showBusiness
            ? renderDashboardPage('business', 'Business Dashboard', business, businessMetrics, businessMonthOptions)
            : null}

          <section className="stats-page page">
            <h1>Personal Stats</h1>
            <p className="subtitle">
              {summarizeComparison(statsSeries.todaySpend, statsSeries.yesterdaySpend, settings.currencySymbol, 'today compared to yesterday')}
            </p>

            <section className="settings-card chart-card">
              <h2>Current Month Target</h2>
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!targetInput.trim()) {
                    saveSettings({ monthlyTargetCents: null })
                    setTargetInput('')
                    setBackupMessage('')
                    return
                  }
                  const parsed = parseCurrencyInputToCents(targetInput)
                  if (!parsed) {
                    setBackupMessage('Enter a valid target amount, like 1500.00 or 1500,00.')
                    return
                  }
                  saveSettings({ monthlyTargetCents: parsed })
                  setTargetInput((parsed / 100).toFixed(2))
                  setBackupMessage('')
                }}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={`${settings.currencySymbol}1200.00`}
                  value={targetInput}
                  onChange={(event) => setTargetInput(event.target.value)}
                />
                <button type="submit">Save Target</button>
              </form>
              {targetCents === null ? (
                <p className="empty">No target set for this month.</p>
              ) : (
                <div className="target-grid">
                  <p>
                    <span>Target</span>
                    <strong>{formatCents(targetCents, settings.currencySymbol)}</strong>
                  </p>
                  <p>
                    <span>Spent</span>
                    <strong>{formatCents(currentMonthSpend, settings.currencySymbol)}</strong>
                  </p>
                  <p>
                    <span>Remaining</span>
                    <strong className={remainingBudgetCents !== null && remainingBudgetCents < 0 ? 'expense-outflow' : ''}>
                      {formatCents(remainingBudgetCents ?? 0, settings.currencySymbol)}
                    </strong>
                  </p>
                  <p>
                    <span>Per-day allowance</span>
                    <strong className={dailyAllowanceCents !== null && dailyAllowanceCents < 0 ? 'expense-outflow' : ''}>
                      {formatCents(dailyAllowanceCents ?? 0, settings.currencySymbol)}
                    </strong>
                  </p>
                </div>
              )}
            </section>

            <section className="settings-card chart-card">
              <h2>Daily Spending (7 days)</h2>
              {personal.expenses.length === 0 ? (
                <p className="empty">No personal expenses yet. Add one to see trend lines.</p>
              ) : (
                <>
                  <div className="line-chart-shell">
                    <div className="y-axis-labels" aria-hidden="true">
                      {[1, 0.66, 0.33, 0].map((multiplier) => (
                        <span key={multiplier}>{formatCents(Math.round(maxDaily * multiplier), settings.currencySymbol)}</span>
                      ))}
                    </div>
                    <svg viewBox="0 0 100 100" className="line-chart" aria-label="Daily spending chart">
                      <polyline points={dailyPoints} />
                    </svg>
                  </div>
                  <div className="axis-labels">
                    {statsSeries.daily.map((point) => (
                      <span key={point.label}>{point.label}</span>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className="settings-card chart-card">
              <h2>Monthly Spending</h2>
              <p className="subtitle">
                {summarizeComparison(
                  statsSeries.thisMonthSpend,
                  statsSeries.prevMonthSpend,
                  settings.currencySymbol,
                  'this month compared to last month',
                )}
              </p>
              <div className="month-bars" role="img" aria-label="Monthly spending bars">
                {statsSeries.monthly.map((point) => (
                  <div key={point.label} className="month-bar-wrap">
                    <span className="month-amount">{formatCents(point.amountCents, settings.currencySymbol)}</span>
                    <div className="month-bar" style={{ height: `${Math.max((point.amountCents / maxMonthly) * 96, 8)}px` }} />
                    <span>{point.label}</span>
                  </div>
                ))}
              </div>
            </section>
          </section>

          {settings.showNotes ? (
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
          ) : null}

          <section className="settings-page page">
            <h1>Settings</h1>
            <p className="subtitle">Customize categories and currency preferences.</p>

            <section className="settings-card">
              <h2>Visible Tabs</h2>
              <div className="toggle-row">
                <span>Show Business</span>
                <button
                  type="button"
                  className={settings.showBusiness ? 'chip active' : 'chip'}
                  onClick={toggleBusinessVisibility}
                >
                  {settings.showBusiness ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="toggle-row">
                <span>Show Notes</span>
                <button
                  type="button"
                  className={settings.showNotes ? 'chip active' : 'chip'}
                  onClick={toggleNotesVisibility}
                >
                  {settings.showNotes ? 'ON' : 'OFF'}
                </button>
              </div>
            </section>

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

            <section className="settings-card danger-card">
              <h2>Danger Zone</h2>
              <p className="subtitle">This clears Personal and Business spending only. Notes, categories, and settings stay.</p>
              <button type="button" className="danger-button wide" onClick={() => setConfirmClearOpen(true)}>
                Clear all data
              </button>
            </section>

            <section className="settings-card">
              <h2>Backup & Restore</h2>
              <p className="subtitle">Export a backup file to iCloud Drive and import it later to restore everything.</p>
              <div className="backup-actions">
                <button type="button" className="chip active" onClick={exportBackup}>
                  Export backup file
                </button>
                <button type="button" className="chip" onClick={requestImportBackup}>
                  Import backup file
                </button>
              </div>
              {backupMessage ? <p className="backup-message">{backupMessage}</p> : null}
              <input ref={backupInputRef} type="file" accept="application/json" onChange={onBackupFileSelected} hidden />
            </section>
          </section>
        </div>
      </div>

      {(effectiveActiveTab === 'personal' || effectiveActiveTab === 'business') && !showExpenseEditor ? (
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
                ref={amountInputRef}
                type="text"
                inputMode="decimal"
                autoFocus
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

      {confirmClearOpen ? (
        <div className="action-sheet-backdrop" onClick={() => setConfirmClearOpen(false)}>
          <div className="action-sheet" onClick={(event) => event.stopPropagation()}>
            <h3>Clear spending data?</h3>
            <p className="subtitle">This removes all Personal and Business expenses only.</p>
            <button type="button" className="danger-button" onClick={clearSpendingData}>
              Yes, clear spending data
            </button>
            <button type="button" onClick={() => setConfirmClearOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {showImportConfirm && pendingBackupImport ? (
        <div
          className="action-sheet-backdrop"
          onClick={() => {
            setShowImportConfirm(false)
            setPendingBackupImport(null)
          }}
        >
          <div className="action-sheet" onClick={(event) => event.stopPropagation()}>
            <h3>Import backup and overwrite data?</h3>
            <p className="subtitle">This replaces existing Personal, Business, Notes, Settings, and month selections.</p>
            <button type="button" className="danger-button" onClick={confirmImportBackup}>
              Yes, import backup
            </button>
            <button
              type="button"
              onClick={() => {
                setShowImportConfirm(false)
                setPendingBackupImport(null)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default App
