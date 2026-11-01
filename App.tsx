import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Animated, Easing, Linking, Modal, Pressable, RefreshControl,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BootScreen } from './src/components/BootScreen';
import { CATEGORIES, type StoreApp } from './src/catalog';
import { API_BASE_URL } from './src/config';
import { fetchCatalog } from './src/remote';
import { theme as C } from './src/theme';
import { isInstallerAvailable, canRequestInstall, openInstallSettings, launchApkInstaller } from './src/nativeInstaller';

type Tab = 'home' | 'browse' | 'downloads' | 'profile';
type DownloadRecord = { id: string; version: string; name: string; path: string; savedAt: string; sha256: string };
type IonName = React.ComponentProps<typeof Ionicons>['name'];
const SAVE_KEY = '@horanov-store:v04'; // Preserve downloads and favorites from v0.4.
const OLD_KEY = '@horanov-store-local:v1';
const TABS: { id: Tab; title: string; icon: IonName; active: IonName }[] = [
  { id: 'home', title: 'Головна', icon: 'home-outline', active: 'home' },
  { id: 'browse', title: 'Каталог', icon: 'grid-outline', active: 'grid' },
  { id: 'downloads', title: 'Файли', icon: 'download-outline', active: 'download' },
  { id: 'profile', title: 'Профіль', icon: 'person-outline', active: 'person' },
];
const shade = { shadowColor: '#56506F', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.055, shadowRadius: 19, elevation: 2 } as const;
const stamp = (app: StoreApp) => `${app.id}::${app.version}`;
const safeFileName = (app: StoreApp) => `${(app.id + '-' + app.version).replace(/[^a-z0-9._-]/gi, '_').slice(0, 120)}.apk`;
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} МБ`;
const categoryIcon = (category: string) => ({ 'Усі': '✨', 'Інструменти': '🛠️', 'Продуктивність': '📋', 'Освіта': '📚', 'Розваги': '🎮', 'Інше': '📦' } as Record<string, string>)[category] ?? '📦';

function AppIcon({ app, large = false }: { app: StoreApp; large?: boolean }) {
  return <View style={[s.appIcon, large && s.appIconLarge, { backgroundColor: `${app.accent}18` }]}>
    <Text style={[s.appIconLabel, large && s.appIconLabelLarge, { color: app.accent }]}>{app.icon || '📦'}</Text>
  </View>;
}
function BrandMark({ small = false }: { small?: boolean }) {
  return <LinearGradient colors={['#FF9D5F', '#FF752E', '#F15B20']} style={[s.brandMark, small && s.brandMarkSmall]}>
    <Text style={[s.brandLetter, small && s.brandLetterSmall]}>H</Text>
  </LinearGradient>;
}
function IconButton({ icon, onPress, label }: { icon: IonName; onPress: () => void; label: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} style={s.iconButton} onPress={onPress}>
    <Ionicons name={icon} size={20} color={C.text}/>
  </Pressable>;
}
function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <View style={s.sectionTitleRow}><Text style={s.sectionTitle}>{title}</Text>{action && onAction ?
    <Pressable onPress={onAction} style={s.seeAll}><Text style={s.seeAllText}>{action}</Text><Ionicons name="chevron-forward" size={15} color={C.primary}/></Pressable> : null}</View>;
}
function EmptyState({ emoji, title, detail, onRetry }: { emoji: string; title: string; detail: string; onRetry?: () => void }) {
  return <View style={s.emptyCard}>
    <View style={s.emptyGlyph}><Text style={{ fontSize: 32 }}>{emoji}</Text></View>
    <Text style={s.emptyTitle}>{title}</Text><Text style={s.emptyText}>{detail}</Text>
    {onRetry ? <Pressable onPress={onRetry} style={s.emptyRetry}><Ionicons name="refresh-outline" size={16} color="#FFF"/><Text style={s.emptyRetryText}>Повторити</Text></Pressable> : null}
  </View>;
}

export default function App() { return <SafeAreaProvider><Store/></SafeAreaProvider>; }

function Store() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('home');
  const [boot, setBoot] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('Усі');
  const [apps, setApps] = useState<StoreApp[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [selected, setSelected] = useState<StoreApp | null>(null);
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeDownload, setActiveDownload] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [loaded, setLoaded] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const taskRef = useRef<ReturnType<typeof File.createDownloadTask> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const current = await AsyncStorage.getItem(SAVE_KEY);
        if (current) {
          const data = JSON.parse(current) as { savedIds?: string[]; downloads?: DownloadRecord[] };
          if (alive && Array.isArray(data.savedIds)) setSavedIds(data.savedIds.filter(x => typeof x === 'string'));
          if (alive && Array.isArray(data.downloads)) setDownloads(data.downloads.filter(x => typeof x.path === 'string' && typeof x.id === 'string'));
        } else {
          const old = await AsyncStorage.getItem(OLD_KEY);
          if (old && alive) {
            const parsed = JSON.parse(old) as { savedIds?: string[] };
            if (Array.isArray(parsed.savedIds)) setSavedIds(parsed.savedIds.map(x => x.replace(/^cloud:/, '')).filter(x => !x.startsWith('demo-') && !x.startsWith('app-')));
          }
        }
      } catch { /* Preferences are optional. */ }
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (loaded) AsyncStorage.setItem(SAVE_KEY, JSON.stringify({ savedIds, downloads })).catch(() => {}); }, [loaded, savedIds, downloads]);

  const reload = useCallback(async () => {
    setLoading(true); setStatus('connecting');
    try { const next = await fetchCatalog(); setApps(next); setStatus('online'); setError(''); }
    catch (e) { setStatus('offline'); setError(e instanceof Error ? e.message : 'Не вдалося зв’язатися з сервером'); }
    finally { setLoading(false); setBoot(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const filtered = useMemo(() => apps.filter(a =>
    (category === 'Усі' || category === a.category) &&
    `${a.name} ${a.description} ${a.developer}`.toLowerCase().includes(query.trim().toLowerCase())), [apps, category, query]);
  const savedApps = useMemo(() => apps.filter(a => savedIds.includes(a.id)), [apps, savedIds]);
  const featured = apps.find(a => a.featured) || apps[0];
  // These are *downloaded APKs* that have a newer catalog version, not installed apps.
  const availableUpdates = useMemo(() => downloads.flatMap(d => {
    const current = apps.find(a => a.id === d.id);
    return current && current.version !== d.version && current.sha256 !== d.sha256 && !downloads.some(latest => latest.id === current.id && latest.sha256 === current.sha256) ? [{ old: d, app: current }] : [];
  }), [apps, downloads]);
  const navigate = (next: Tab) => {
    if (next === tab) return;
    fade.setValue(.18); setTab(next);
    Animated.timing(fade, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  };
  const recordFor = (app: StoreApp) => downloads.find(d => d.id === app.id && d.version === app.version && d.sha256 === app.sha256);
  const toggleSaved = (app: StoreApp) => setSavedIds(prev => prev.includes(app.id) ? prev.filter(x => x !== app.id) : [...prev, app.id]);

  // The installer is available only in the standalone EAS Android APK, not Expo Go.
  // Re-hash the file before passing it to Android, even if it was previously saved.
  const installDownloaded = async (item: DownloadRecord) => {
    if (!isInstallerAvailable) {
      Alert.alert('Потрібна Android-збірка', 'У Expo Go немає вбудованого інсталятора. Для встановлення з Horanov Store потрібен власний APK магазину.');
      return;
    }
    try {
      const file = new File(item.path);
      if (!file.exists) throw new Error('APK більше немає у памʼяті додатка. Завантаж його повторно.');
      const actual = await file.digest('SHA-256');
      if (actual.toLowerCase() !== item.sha256.toLowerCase()) {
        try { file.delete(); } catch { /* File is already invalid. */ }
        setDownloads(prev => prev.filter(d => !(d.id === item.id && d.version === item.version)));
        throw new Error('SHA-256 файлу не збігається. Завантаж APK повторно.');
      }
      if (!await canRequestInstall()) {
        Alert.alert('Потрібен дозвіл Android', 'Дозволь Horanov Store встановлювати додатки з цього джерела. Після повернення натисни «Встановити» ще раз.', [
          { text: 'Пізніше', style: 'cancel' },
          { text: 'Відкрити налаштування', onPress: () => { void openInstallSettings().catch(err => Alert.alert('Помилка', String(err))); } },
        ]);
        return;
      }
      await launchApkInstaller(file.uri);
      // This only opens Android's installer; the user must confirm there.
    } catch (err) {
      Alert.alert('Не вдалося встановити', err instanceof Error ? err.message : String(err));
    }
  };

  const downloadApk = async (app: StoreApp) => {
    if (activeDownload) { Alert.alert('Завантаження', 'Дочекайся завершення поточного завантаження.'); return; }
    const target = new File(Paths.document, safeFileName(app));
    setActiveDownload(stamp(app)); setProgress(0); setProgressLabel('Підключаємося до GitHub…');
    try {
      if (target.exists) target.delete();
      const task = File.createDownloadTask(app.apkUrl, target, { onProgress: ({ bytesWritten, totalBytes }) => {
        setProgress(totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : 0);
        setProgressLabel(totalBytes > 0 ? `${mb(bytesWritten)} / ${mb(totalBytes)}` : `${mb(bytesWritten)} завантажено`);
      } });
      taskRef.current = task;
      const result = await task.downloadAsync();
      if (!result || !result.exists || !result.size) throw new Error('Файл не завантажився або виявився порожнім');
      setProgressLabel('Перевіряємо SHA-256…');
      const actual = await result.digest('SHA-256');
      if (actual.toLowerCase() !== app.sha256.toLowerCase()) {
        result.delete(); throw new Error('SHA-256 не збігається. Файл відхилено — перевір реліз GitHub.');
      }
      const item: DownloadRecord = { id: app.id, name: app.name, version: app.version, sha256: app.sha256, path: result.uri, savedAt: new Date().toISOString() };
      setDownloads(prev => [item, ...prev.filter(x => !(x.id === app.id && x.version === app.version))]);
      Alert.alert('APK готовий ✨', `${app.name} v${app.version} завантажено. SHA-256 збігається.`, isInstallerAvailable ? [
        { text: 'Пізніше' },
        { text: 'Встановити', onPress: () => { void installDownloaded(item); } },
      ] : [
        { text: 'Добре' },
        { text: 'До файлів', onPress: () => { setSelected(null); navigate('downloads'); } },
      ]);
    } catch (e) {
      if (target.exists) { try { target.delete(); } catch {} }
      Alert.alert('Помилка завантаження', e instanceof Error ? e.message : 'Не вдалося завантажити APK');
    } finally { taskRef.current = null; setActiveDownload(null); setProgress(0); setProgressLabel(''); }
  };
  const shareDownloaded = async (item: DownloadRecord) => {
    try {
      const file = new File(item.path);
      if (!file.exists) { Alert.alert('Файл відсутній', 'APK був видалений. Завантаж його ще раз.'); return; }
      if (!(await Sharing.isAvailableAsync())) throw new Error('Поширення файлів недоступне');
      await Sharing.shareAsync(file.uri, { mimeType: 'application/vnd.android.package-archive', dialogTitle: 'Поділитися APK' });
    } catch (e) { Alert.alert('Помилка', e instanceof Error ? e.message : 'Не вдалося відкрити системне меню'); }
  };
  const removeDownloaded = (item: DownloadRecord) => {
    Alert.alert('Видалити APK?', `${item.name} v${item.version}`, [
      { text: 'Скасувати', style: 'cancel' },
      { text: 'Видалити', style: 'destructive', onPress: () => {
        try { const file = new File(item.path); if (file.exists) file.delete(); } catch {}
        setDownloads(prev => prev.filter(x => !(x.id === item.id && x.version === item.version)));
      } },
    ]);
  };
  const openAdmin = () => { void Linking.openURL(`${API_BASE_URL}/admin`).catch(() => Alert.alert('Не відкривається', 'Перевір доступність store.horanov.com')); };

  const AppRow = ({ app, index = 0 }: { app: StoreApp; index?: number }) => (
    <Pressable onPress={() => setSelected(app)} style={({ pressed }) => [s.appRow, pressed && { opacity: .7 }]}>
      <AppIcon app={app}/><View style={s.appText}>
        <Text numberOfLines={1} style={s.appName}>{app.name}</Text>
        <Text numberOfLines={1} style={s.appMeta}>{app.category} · {app.developer}</Text>
        <Text style={s.versionPill}>v{app.version}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Завантажити ${app.name}`} onPress={(ev) => { ev.stopPropagation(); setSelected(app); }} style={s.listAction}>
        <Ionicons name={index === -1 ? 'chevron-forward' : 'cloud-download-outline'} size={20} color={C.primary}/>
      </Pressable>
    </Pressable>
  );
  if (boot || !loaded) return <BootScreen/>;

  return <SafeAreaView edges={['top','left','right']} style={s.root}>
    <StatusBar barStyle="dark-content" backgroundColor="#FBFAFD"/>
    <View style={s.header}>
      <View style={s.headerBrand}><BrandMark small/><Text style={s.headerBrandText}>Horanov Store</Text></View>
      <View style={s.headerControls}>
        <Pressable style={[s.livePill, status === 'offline' && s.offlinePill]} onPress={() => void reload()}>
          <View style={[s.liveDot, { backgroundColor: status === 'online' ? C.success : status === 'connecting' ? '#ECA242' : '#D67C6B' }]}/>
          <Text style={s.liveLabel}>{status === 'online' ? 'Live' : status === 'connecting' ? '…' : 'Offline'}</Text>
        </Pressable>
        <IconButton icon="refresh-outline" onPress={() => void reload()} label="Оновити каталог"/>
      </View>
    </View>
    <Animated.View style={[s.body,{opacity:fade}]}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={C.primary} colors={[C.primary]}/> }>

        {status === 'offline' && <Pressable onPress={reload} style={s.networkNotice}>
          <Text style={{ fontSize: 23 }}>📡</Text><View style={{ flex:1 }}><Text style={s.networkTitle}>Немає доступу до каталогу</Text><Text style={s.networkText}>Не вдається знайти сервер. Перевір DNS своєї Wi-Fi мережі або спробуй мобільний інтернет. {error}</Text></View><Ionicons name="refresh" size={20} color="#B9623B"/>
        </Pressable>}

        {tab === 'home' && <>
          <Text style={s.eyebrow}>ТВІЙ ANDROID-ПРОСТІР</Text>
          <Text style={s.heroTitle}>Відкривай нове{ '\n' }щодня 🚀</Text>
          <Text style={s.heroSubtitle}>Усі твої Android-додатки — в одному красивому місці.</Text>
          <Pressable style={s.search} onPress={() => navigate('browse')}>
            <Ionicons name="search-outline" size={19} color={C.muted}/><Text style={s.searchPlaceholder}>Пошук додатків, ігор, інструментів...</Text><View style={s.searchBadge}><Text style={{ fontSize: 13 }}>⌕</Text></View>
          </Pressable>
          <View style={s.quickCategories}>
            {(['Усі','Інструменти','Продуктивність','Розваги'] as const).map(cat => <Pressable key={cat} style={s.quickCategory} onPress={() => { setCategory(cat); setQuery(''); navigate('browse'); }}>
              <View style={[s.quickIcon, cat === 'Усі' && s.quickIconActive]}><Text style={s.quickEmoji}>{categoryIcon(cat)}</Text></View>
              <Text numberOfLines={1} style={s.quickLabel}>{cat === 'Усі' ? 'Усі' : cat === 'Інструменти' ? 'Сервіси' : cat === 'Продуктивність' ? 'Робота' : 'Ігри'}</Text>
            </Pressable>)}
          </View>
          {featured && <>
            <SectionTitle title="Рекомендуємо ✨" action="Усі" onAction={() => navigate('browse')}/>
            <Pressable onPress={() => setSelected(featured)} style={s.featureCard}>
              <LinearGradient colors={['#FFF4E7','#FFE4D5','#F2EAFF']} start={{x:0,y:0}} end={{x:1,y:1}} style={s.featureGradient}>
                <View style={s.featureHead}><Text style={s.featureTag}>✦ ВИБІР HORANOV</Text><View style={s.featureArrow}><Ionicons name="arrow-forward" size={18} color={C.primary}/></View></View>
                <View style={s.featureBody}><AppIcon app={featured} large/><View style={{flex:1}}><Text style={s.featureName} numberOfLines={1}>{featured.name}</Text><Text style={s.featureDesc} numberOfLines={3}>{featured.description || featured.category}</Text><Text style={s.featureVersion}>v{featured.version}</Text></View></View>
              </LinearGradient>
            </Pressable>
          </>}
          <SectionTitle title="Нові додатки 🔥" action="Весь каталог" onAction={() => navigate('browse')}/>
          {apps.length ? <View style={s.listCard}>{apps.slice(0, 7).map(app => <AppRow key={app.id} app={app}/>)}</View> :
            <EmptyState emoji="📦" title={status === 'offline' ? 'Сервер недоступний' : 'Тут скоро будуть додатки'} detail={status === 'offline' ? 'Можна повторити підключення.' : 'Опублікуй перший реліз в адмінпанелі — він одразу з’явиться тут.'} onRetry={status === 'offline' ? reload : undefined}/>}
          <View style={s.tipCard}><Text style={{fontSize:25}}>🔒</Text><View style={{flex:1}}><Text style={s.tipTitle}>Контроль кожного APK</Text><Text style={s.tipText}>Після завантаження звіряємо SHA-256 з даними релізу.</Text></View></View>
        </>}

        {tab === 'browse' && <>
          <Text style={s.eyebrow}>ЗНАЙДИ СВОЄ ✨</Text><Text style={s.pageTitle}>Каталог додатків</Text>
          <Text style={s.pageSubtitle}>{apps.length} додатків у нашому онлайн-каталозі</Text>
          <View style={s.search}><Ionicons name="search-outline" size={21} color={C.muted}/><TextInput style={s.searchInput} placeholder="Пошук за назвою чи описом" value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" placeholderTextColor="#ADAEB9"/><Pressable onPress={() => setQuery('')}><Ionicons name={query ? 'close-circle' : 'options-outline'} size={20} color={C.muted}/></Pressable></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categoryList}>
            {CATEGORIES.map(cat => <Pressable key={cat} style={[s.categoryChip,category === cat && s.categoryChipActive]} onPress={() => setCategory(cat)}><Text style={s.categoryEmoji}>{categoryIcon(cat)}</Text><Text style={[s.categoryText, category === cat && s.categoryTextActive]}>{cat}</Text></Pressable>)}
          </ScrollView>
          <SectionTitle title={query || category !== 'Усі' ? 'Результати пошуку' : 'Усі додатки'} action={`${filtered.length} знайдено`} onAction={() => {setQuery(''); setCategory('Усі');}}/>
          {filtered.length ? <View style={s.listCard}>{filtered.map(app => <AppRow app={app} key={app.id}/>)}</View> :
            <EmptyState emoji="🔎" title={apps.length ? 'Нічого не знайшли' : 'Каталог порожній'} detail={apps.length ? 'Спробуй інший пошуковий запит або категорію.' : 'Додатки з’являться після публікації на Cloudflare.'}/>}
        </>}

        {tab === 'downloads' && <>
          <Text style={s.eyebrow}>ЗАВАНТАЖЕННЯ 📲</Text><Text style={s.pageTitle}>Файли та оновлення</Text><Text style={s.pageSubtitle}>Завантажені APK і нові версії з каталогу.</Text>
          {activeDownload && <View style={s.downloadProgressCard}><View style={s.flexBetween}><Text style={s.progressHeading}>⬇️ Завантажуємо APK</Text><Text style={s.progressPercent}>{progress > 0 ? `${Math.round(progress*100)}%` : '…'}</Text></View><Text style={s.progressDescription}>{progressLabel}</Text><View style={s.track}><View style={[s.bar,{width:`${Math.round(progress*100)}%`}]}/></View></View>}
          {availableUpdates.length > 0 && <>
            <SectionTitle title="Нові версії 🔥"/>
            <Text style={s.sectionExplain}>Порівнюємо збережені APK з онлайн-каталогом, не зі встановленими додатками.</Text>
            <View style={s.listCard}>{availableUpdates.map(({app,old}) => <View key={old.id} style={s.updateRow}><AppIcon app={app}/><View style={{flex:1}}><Text style={s.appName} numberOfLines={1}>{app.name}</Text><Text style={s.appMeta}>v{old.version} → v{app.version}</Text></View><Pressable style={s.updateButton} onPress={() => setSelected(app)}><Text style={s.updateButtonText}>Оновити</Text></Pressable></View>)}</View>
          </>}
          <SectionTitle title={`Мої APK 📦`}/>
          <View style={s.helperCard}><Text style={{fontSize:21}}>{isInstallerAvailable ? '🛡️' : '💡'}</Text><Text style={s.helperText}>{isInstallerAvailable ? 'Натисни «Встановити» — перевіримо SHA-256 і відкриємо інсталятор Android. Підтвердження встановлення залишається за тобою.' : 'В Expo Go можна зберегти APK та поділитися ним. Для кнопки «Встановити» потрібна власна Android-збірка через EAS.'}</Text></View>
          {downloads.length ? downloads.map(d => <View key={`${d.id}:${d.version}`} style={s.fileCard}>
            <View style={s.fileHeading}><View style={s.fileIcon}><Text style={{fontSize:22}}>📦</Text></View><View style={{flex:1}}><Text style={s.fileName} numberOfLines={1}>{d.name}</Text><Text style={s.fileMeta}>v{d.version} · SHA-256 перевірено ✓</Text></View></View>
            <View style={s.fileButtons}>
              {isInstallerAvailable && <Pressable style={s.fileShare} onPress={() => void installDownloaded(d)}><Ionicons name="download-outline" size={17} color="#FFF"/><Text style={s.fileShareText}>Встановити</Text></Pressable>}
              <Pressable style={[s.fileShare, isInstallerAvailable && { flex: 0, paddingHorizontal: 14, backgroundColor: '#FFF0E8' }]} onPress={() => void shareDownloaded(d)}><Ionicons name="share-outline" size={17} color={isInstallerAvailable ? C.primary : '#FFF'}/>{!isInstallerAvailable && <Text style={s.fileShareText}>Поділитися APK</Text>}</Pressable>
              <Pressable accessibilityLabel="Видалити файл" onPress={() => removeDownloaded(d)} style={s.fileDelete}><Ionicons name="trash-outline" size={20} color="#A76F64"/></Pressable>
            </View>
          </View>) : <EmptyState emoji="📂" title="Поки немає завантажень" detail="Обери додаток у каталозі та завантаж його APK."/>}
        </>}

        {tab === 'profile' && <>
          <View style={s.profileHead}><View style={s.avatar}><Text style={{fontSize:34}}>👋</Text></View><View style={{flex:1}}><Text style={s.profileName}>Horanov Store</Text><Text style={s.profileHint}>Твоя незалежна Android-платформа</Text></View></View>
          <View style={s.profileStats}>
            <View style={s.statBox}><Text style={s.statNumber}>{apps.length}</Text><Text style={s.statLabel}>У каталозі</Text></View>
            <View style={s.statDivider}/><View style={s.statBox}><Text style={s.statNumber}>{downloads.length}</Text><Text style={s.statLabel}>APK-файлів</Text></View>
            <View style={s.statDivider}/><View style={s.statBox}><Text style={s.statNumber}>{savedApps.length}</Text><Text style={s.statLabel}>Обраних</Text></View>
          </View>
          <SectionTitle title="Керування ⚙️"/>
          <View style={s.shortcuts}>
            <Pressable onPress={openAdmin} style={s.shortcut}><View style={s.shortcutIcon}><Text style={{fontSize:26}}>☁️</Text></View><Text style={s.shortcutTitle}>Адмінпанель</Text><Text style={s.shortcutDesc}>Керуй додатками та релізами</Text></Pressable>
            <Pressable onPress={() => void reload()} style={s.shortcut}><View style={s.shortcutIcon}><Text style={{fontSize:26}}>🔄</Text></View><Text style={s.shortcutTitle}>Синхронізація</Text><Text style={s.shortcutDesc}>Оновити онлайн-каталог</Text></Pressable>
          </View>
          <SectionTitle title="Моє обране ❤️"/>
          {savedApps.length ? <View style={s.listCard}>{savedApps.map(app => <AppRow key={app.id} app={app} index={-1}/>)}</View> : <EmptyState emoji="🧡" title="Поки немає обраного" detail="Відкрий будь-який додаток і додай його до обраного."/>}
          <View style={s.aboutCard}><View style={s.flexBetween}><Text style={s.aboutLabel}>Horanov Store</Text><Text style={s.aboutVersion}>v0.5.0</Text></View><Text style={s.aboutText}>Cloudflare Workers + D1 · GitHub Releases. {isInstallerAvailable ? 'Нативний інсталятор Android активний.' : 'Режим Expo Go (без встановлення APK).'}</Text><Text style={s.endpoint} numberOfLines={1}>{API_BASE_URL}</Text></View>
        </>}
      </ScrollView>
    </Animated.View>

    <View style={[s.navOuter,{ paddingBottom: Math.max(insets.bottom, 10) + 8 }]}>
      <View style={s.navGlass}>{TABS.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{selected:tab===item.id}} style={s.navItem} onPress={() => navigate(item.id)}>
        <View style={[s.navIcon,tab===item.id && s.navIconActive]}><Ionicons name={tab===item.id ? item.active : item.icon} size={21} color={tab===item.id ? '#FFFFFF' : '#888998'}/></View>
        <Text style={[s.navText,tab===item.id && s.navTextActive]}>{item.title}</Text>
      </Pressable>)}</View>
    </View>

    <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => {if(!activeDownload)setSelected(null);}}>
      <View style={s.sheetOverlay}><Pressable style={StyleSheet.absoluteFillObject} onPress={() => {if(!activeDownload)setSelected(null);}}/>
        {selected && <View style={[s.sheet,{paddingBottom:Math.max(insets.bottom,12)+15}]}>
          <View style={s.sheetHandle}/><Pressable accessibilityLabel="Закрити" onPress={() => {if(!activeDownload)setSelected(null);}} style={s.sheetClose}><Ionicons name="close" size={21} color={C.text}/></Pressable>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.sheetContent}>
            <View style={s.sheetAppHeader}><AppIcon app={selected} large/><View style={{flex:1}}><Text style={s.sheetTitle} numberOfLines={2}>{selected.name}</Text><Text style={s.sheetDeveloper}>{selected.developer}</Text><View style={s.sheetVerified}><Ionicons name="shield-checkmark" size={13} color={C.success}/><Text style={s.sheetVerifiedText}>Перевірка SHA-256</Text></View></View></View>
            <View style={s.detailMeta}><View style={s.detailStat}><Text style={s.detailStatEmoji}>📦</Text><Text style={s.detailStatMain}>v{selected.version}</Text><Text style={s.detailStatSub}>Версія</Text></View><View style={s.detailSplit}/><View style={s.detailStat}><Text style={s.detailStatEmoji}>{categoryIcon(selected.category)}</Text><Text style={s.detailStatMain} numberOfLines={1}>{selected.category}</Text><Text style={s.detailStatSub}>Категорія</Text></View></View>
            <Pressable disabled={!!activeDownload} style={[s.downloadButton, !!activeDownload && {opacity:.7}]} onPress={() => {
              const local = recordFor(selected);
              if (local && isInstallerAvailable) void installDownloaded(local);
              else void downloadApk(selected);
            }}><Ionicons name={recordFor(selected) && isInstallerAvailable ? 'shield-checkmark-outline' : 'download-outline'} size={20} color="#FFF"/>
              <Text style={s.downloadButtonText}>{activeDownload===stamp(selected) ? 'Завантажуємо…' : recordFor(selected) && isInstallerAvailable ? 'Встановити APK' : isInstallerAvailable ? 'Завантажити й встановити' : recordFor(selected) ? 'Завантажити повторно' : 'Завантажити APK'}</Text>
            </Pressable>
            {activeDownload===stamp(selected) && <View style={s.sheetProgress}><View style={s.flexBetween}><Text style={s.progressHeading}>{progressLabel}</Text><Text style={s.progressPercent}>{Math.round(progress*100)}%</Text></View><View style={s.track}><View style={[s.bar,{width:`${Math.round(progress*100)}%`}]}/></View></View>}
            {recordFor(selected) && <Pressable style={s.sheetSecondary} onPress={() => {setSelected(null);navigate('downloads');}}><Ionicons name="folder-open-outline" size={18} color={C.primary}/><Text style={s.sheetSecondaryText}>Переглянути завантажений APK</Text></Pressable>}
            <Pressable style={s.sheetSecondary} onPress={() => toggleSaved(selected)}><Ionicons name={savedIds.includes(selected.id) ? 'heart' : 'heart-outline'} size={19} color={C.primary}/><Text style={s.sheetSecondaryText}>{savedIds.includes(selected.id) ? 'Прибрати з обраного' : 'Додати до обраного'}</Text></Pressable>
            <SectionTitle title="Про додаток"/><Text style={s.description}>{selected.description || 'Опис ще не додано.'}</Text>
            <View style={s.hashBadge}><Text style={{fontSize:20}}>🔒</Text><Text style={s.hashBadgeText}>{isInstallerAvailable ? 'Перед встановленням перевіряємо SHA-256. Далі Android запропонує підтвердити встановлення.' : 'Перевіряємо SHA-256 після завантаження. В Expo Go встановлення APK недоступне — потрібна окрема збірка Horanov Store.'}</Text></View>
          </ScrollView>
        </View>}
      </View>
    </Modal>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  root:{flex:1,backgroundColor:C.bg},body:{flex:1},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:20,paddingVertical:12,backgroundColor:'#FBFAFDEE',borderBottomWidth:1,borderBottomColor:'#F0EFF3'},
  headerBrand:{flexDirection:'row',alignItems:'center',gap:9},headerBrandText:{color:C.text,fontSize:17,fontWeight:'900',letterSpacing:-.7},headerControls:{flexDirection:'row',alignItems:'center',gap:9},
  brandMark:{height:48,width:48,borderRadius:15,alignItems:'center',justifyContent:'center'},brandMarkSmall:{height:31,width:31,borderRadius:9},brandLetter:{fontSize:28,fontWeight:'900',color:'#FFF',fontStyle:'italic',letterSpacing:-2},brandLetterSmall:{fontSize:21},
  livePill:{flexDirection:'row',gap:6,alignItems:'center',backgroundColor:'#EFF9F4',paddingHorizontal:9,paddingVertical:8,borderRadius:20},offlinePill:{backgroundColor:'#FFF1EB'},liveDot:{width:7,height:7,borderRadius:4},liveLabel:{fontWeight:'800',color:'#5A6961',fontSize:10},iconButton:{height:33,width:33,alignItems:'center',justifyContent:'center',backgroundColor:'#FFF',borderRadius:15,borderWidth:1,borderColor:C.line},
  content:{paddingHorizontal:20,paddingTop:27,paddingBottom:40},eyebrow:{fontSize:10,letterSpacing:1.8,fontWeight:'900',color:C.primary,marginBottom:12},heroTitle:{fontSize:33,lineHeight:40,letterSpacing:-1.1,fontWeight:'900',color:C.text},heroSubtitle:{fontSize:13,lineHeight:21,color:C.muted,marginTop:9,marginBottom:20},
  pageTitle:{fontSize:29,fontWeight:'900',letterSpacing:-1,color:C.text},pageSubtitle:{fontSize:12.5,color:C.muted,marginTop:9,marginBottom:23,lineHeight:19},
  search:{height:50,backgroundColor:'#FFF',borderRadius:18,paddingHorizontal:15,borderWidth:1,borderColor:C.line,flexDirection:'row',alignItems:'center',gap:10,...shade},searchPlaceholder:{color:'#B0ADB9',flex:1,fontSize:12},searchInput:{flex:1,color:C.text,fontSize:13,padding:0},searchBadge:{width:29,height:29,borderRadius:10,backgroundColor:'#F7F6F8',alignItems:'center',justifyContent:'center'},
  quickCategories:{flexDirection:'row',justifyContent:'space-between',gap:8,marginTop:20,marginBottom:28},quickCategory:{flex:1,alignItems:'center',gap:7},quickIcon:{width:'100%',height:62,borderRadius:18,backgroundColor:'#F0F0FA',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#FFFFFF'},quickIconActive:{backgroundColor:'#FFF0E7'},quickEmoji:{fontSize:25},quickLabel:{fontSize:10,color:'#646470',fontWeight:'700'},
  sectionTitleRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:14,marginTop:8},sectionTitle:{fontWeight:'900',fontSize:18,color:C.text,letterSpacing:-.4},seeAll:{flexDirection:'row',alignItems:'center',gap:1},seeAllText:{fontWeight:'800',fontSize:11,color:C.primary},
  featureCard:{borderRadius:25,overflow:'hidden',marginBottom:25,...shade},featureGradient:{padding:18,minHeight:170},featureHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},featureTag:{fontWeight:'900',fontSize:9.5,color:'#C26638',letterSpacing:1,backgroundColor:'#FFFFFFAD',paddingHorizontal:10,paddingVertical:8,borderRadius:18,overflow:'hidden'},featureArrow:{height:30,width:30,borderRadius:15,backgroundColor:'#FFFFFFBD',alignItems:'center',justifyContent:'center'},featureBody:{flexDirection:'row',alignItems:'center',gap:15,marginTop:18},featureName:{fontWeight:'900',fontSize:20,color:C.text,letterSpacing:-.4},featureDesc:{color:'#79727A',fontSize:12,marginTop:6,lineHeight:17},featureVersion:{fontSize:11,fontWeight:'900',color:C.primary,marginTop:10},
  appIcon:{width:54,height:54,borderRadius:17,alignItems:'center',justifyContent:'center'},appIconLarge:{width:80,height:80,borderRadius:23},appIconLabel:{fontSize:26,fontWeight:'900'},appIconLabelLarge:{fontSize:39},listCard:{backgroundColor:'#FFFFFFE9',borderRadius:22,borderColor:'#F0EFF4',borderWidth:1,overflow:'hidden',marginBottom:20,...shade},appRow:{flexDirection:'row',gap:12,alignItems:'center',paddingHorizontal:12,paddingVertical:13,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#EFEFF4'},appText:{flex:1,minWidth:0},appName:{fontSize:14,fontWeight:'900',color:C.text},appMeta:{fontSize:10.5,color:C.muted,marginTop:3},versionPill:{alignSelf:'flex-start',color:C.primary,fontSize:10,fontWeight:'800',marginTop:5,backgroundColor:'#FFF1E9',paddingHorizontal:7,paddingVertical:4,borderRadius:9,overflow:'hidden'},listAction:{height:36,width:36,borderRadius:13,backgroundColor:'#FFF2EA',alignItems:'center',justifyContent:'center'},
  tipCard:{marginTop:5,flexDirection:'row',alignItems:'center',gap:12,padding:16,borderRadius:21,backgroundColor:'#F0F2FF',marginBottom:4},tipTitle:{fontSize:12,fontWeight:'800',color:C.text},tipText:{fontSize:11,color:C.muted,lineHeight:17,marginTop:4},
  categoryList:{gap:8,alignItems:'center',paddingTop:17,paddingBottom:24},categoryChip:{flexDirection:'row',gap:6,alignItems:'center',borderRadius:18,paddingHorizontal:12,paddingVertical:11,borderWidth:1,borderColor:C.line,backgroundColor:'#FFF'},categoryChipActive:{backgroundColor:C.primary,borderColor:C.primary},categoryEmoji:{fontSize:16},categoryText:{fontSize:11,fontWeight:'700',color:'#6D6C7A'},categoryTextActive:{color:'#FFF'},
  emptyCard:{alignItems:'center',paddingHorizontal:24,paddingVertical:32,backgroundColor:'#FFF',borderRadius:24,borderWidth:1,borderColor:C.line,marginBottom:20},emptyGlyph:{width:70,height:70,borderRadius:23,backgroundColor:'#FFF1E9',alignItems:'center',justifyContent:'center'},emptyTitle:{fontWeight:'900',fontSize:16,color:C.text,marginTop:16,textAlign:'center'},emptyText:{textAlign:'center',color:C.muted,fontSize:12,lineHeight:20,marginTop:8},emptyRetry:{backgroundColor:C.primary,borderRadius:13,paddingHorizontal:18,paddingVertical:11,flexDirection:'row',gap:6,alignItems:'center',marginTop:15},emptyRetryText:{color:'#FFF',fontWeight:'800',fontSize:12},
  navOuter:{paddingHorizontal:14,paddingTop:8,backgroundColor:'#F8F8FC'},navGlass:{backgroundColor:'#FFFFFFF5',borderColor:'#FFF',borderWidth:1,borderRadius:26,paddingVertical:7,paddingHorizontal:5,flexDirection:'row',...shade},navItem:{flex:1,alignItems:'center',gap:4,minHeight:55,justifyContent:'center'},navIcon:{height:33,width:47,borderRadius:13,justifyContent:'center',alignItems:'center'},navIconActive:{backgroundColor:C.primary},navText:{fontSize:9.5,fontWeight:'700',color:'#9596A3'},navTextActive:{color:C.primary,fontWeight:'900'},
  networkNotice:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:'#FFF4E8',borderRadius:17,padding:13,marginBottom:18,borderWidth:1,borderColor:'#FFE0CE'},networkTitle:{color:'#9F4B24',fontWeight:'900',fontSize:12},networkText:{color:'#A47864',fontSize:10.5,lineHeight:16,marginTop:4},
  sectionExplain:{color:C.muted,fontSize:11,lineHeight:17,marginBottom:12},downloadProgressCard:{padding:17,backgroundColor:'#FFF',borderRadius:21,marginBottom:20,...shade},progressHeading:{fontSize:12,fontWeight:'900',color:C.text},progressPercent:{fontSize:12,fontWeight:'900',color:C.primary},progressDescription:{fontSize:11,color:C.muted,marginVertical:9},track:{width:'100%',height:7,borderRadius:5,backgroundColor:'#EEE8E4',overflow:'hidden',marginTop:9},bar:{height:7,backgroundColor:C.primary,borderRadius:6},flexBetween:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  updateRow:{flexDirection:'row',gap:11,alignItems:'center',padding:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:C.line},updateButton:{backgroundColor:'#FFF1E7',borderRadius:13,paddingHorizontal:12,paddingVertical:10},updateButtonText:{fontSize:11,fontWeight:'900',color:C.primary},helperCard:{backgroundColor:'#F1F0FD',borderRadius:17,flexDirection:'row',alignItems:'flex-start',gap:10,padding:14,marginBottom:18},helperText:{flex:1,color:'#737185',fontSize:11,lineHeight:18},
  fileCard:{backgroundColor:'#FFF',borderRadius:21,padding:15,marginBottom:12,borderWidth:1,borderColor:C.line,...shade},fileHeading:{flexDirection:'row',alignItems:'center',gap:12},fileIcon:{width:49,height:49,borderRadius:15,backgroundColor:'#FFF1E8',alignItems:'center',justifyContent:'center'},fileName:{fontSize:14,fontWeight:'900',color:C.text},fileMeta:{fontSize:10.5,color:C.muted,marginTop:6},fileButtons:{flexDirection:'row',gap:9,marginTop:15},fileShare:{flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:C.primary,borderRadius:14,paddingVertical:12},fileShareText:{color:'#FFF',fontSize:12,fontWeight:'900'},fileDelete:{height:43,width:47,alignItems:'center',justifyContent:'center',borderRadius:14,backgroundColor:'#FFF0EC'},
  profileHead:{flexDirection:'row',alignItems:'center',gap:14,marginBottom:22},avatar:{width:68,height:68,borderRadius:23,backgroundColor:'#FFE5D6',alignItems:'center',justifyContent:'center'},profileName:{fontSize:21,fontWeight:'900',color:C.text},profileHint:{fontSize:11,color:C.muted,lineHeight:17,marginTop:5},profileStats:{flexDirection:'row',backgroundColor:'#FFF',borderRadius:21,paddingVertical:17,marginBottom:28,borderWidth:1,borderColor:C.line,...shade},statBox:{flex:1,alignItems:'center'},statNumber:{fontSize:22,fontWeight:'900',color:C.text},statLabel:{fontSize:10,color:C.muted,marginTop:5},statDivider:{width:1,backgroundColor:C.line},shortcuts:{flexDirection:'row',gap:11,marginBottom:25},shortcut:{flex:1,backgroundColor:'#FFF',borderRadius:22,padding:14,borderWidth:1,borderColor:C.line,...shade},shortcutIcon:{width:45,height:45,borderRadius:15,backgroundColor:'#FFF0E8',alignItems:'center',justifyContent:'center',marginBottom:15},shortcutTitle:{fontWeight:'900',fontSize:13,color:C.text},shortcutDesc:{fontSize:10.5,color:C.muted,lineHeight:16,marginTop:5},aboutCard:{backgroundColor:'#FFF',borderRadius:20,padding:16,borderWidth:1,borderColor:C.line,marginTop:9,marginBottom:16},aboutLabel:{fontWeight:'900',color:C.text},aboutVersion:{fontSize:11,color:C.primary,fontWeight:'900'},aboutText:{fontSize:11,lineHeight:18,color:C.muted,marginTop:9},endpoint:{fontSize:10,color:'#B2ABB3',marginTop:9},
  sheetOverlay:{flex:1,justifyContent:'flex-end',backgroundColor:'#1D182E66'},sheet:{backgroundColor:'#FBFAFD',borderTopLeftRadius:30,borderTopRightRadius:30,maxHeight:'90%',paddingTop:10},sheetHandle:{width:42,height:5,borderRadius:5,backgroundColor:'#DDDDE4',alignSelf:'center'},sheetClose:{position:'absolute',top:15,right:18,width:32,height:32,borderRadius:13,alignItems:'center',justifyContent:'center',backgroundColor:'#EFEFF4',zIndex:3},sheetContent:{paddingHorizontal:22,paddingTop:30,paddingBottom:14},sheetAppHeader:{flexDirection:'row',alignItems:'center',gap:14},sheetTitle:{fontSize:23,fontWeight:'900',color:C.text},sheetDeveloper:{fontSize:11,color:C.muted,marginTop:5},sheetVerified:{flexDirection:'row',alignItems:'center',gap:5,backgroundColor:'#EAF8F0',alignSelf:'flex-start',paddingHorizontal:9,paddingVertical:6,borderRadius:11,marginTop:10},sheetVerifiedText:{fontSize:10,color:C.success,fontWeight:'800'},
  detailMeta:{flexDirection:'row',backgroundColor:'#FFF',borderRadius:20,paddingVertical:17,marginTop:22,marginBottom:20,borderWidth:1,borderColor:C.line},detailStat:{flex:1,alignItems:'center',paddingHorizontal:7},detailSplit:{width:1,backgroundColor:C.line},detailStatEmoji:{fontSize:19},detailStatMain:{fontSize:12,fontWeight:'900',color:C.text,marginTop:6},detailStatSub:{fontSize:10,color:C.muted,marginTop:3},downloadButton:{backgroundColor:C.primary,borderRadius:16,paddingVertical:16,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:9},downloadButtonText:{fontWeight:'900',color:'#FFF',fontSize:14},sheetSecondary:{flexDirection:'row',gap:8,justifyContent:'center',alignItems:'center',paddingVertical:12},sheetSecondaryText:{fontSize:12,fontWeight:'800',color:C.primary},sheetProgress:{padding:14,borderRadius:15,backgroundColor:'#FFF0E8',marginTop:12},description:{fontSize:12.5,color:'#7B7A87',lineHeight:20,marginBottom:17,marginTop:4},hashBadge:{flexDirection:'row',gap:11,alignItems:'center',padding:14,borderRadius:17,backgroundColor:'#F2F1FC'},hashBadgeText:{flex:1,color:'#797686',fontSize:11,lineHeight:18},
});
