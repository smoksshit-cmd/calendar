/**
 * RP Calendar v2.1.0
 * Архитектура по образцу Chronicle: системный промпт + парсинг тегов + агрегация по чату.
 * v2.1: + система событий (<events>...</events>) и вкладка "Предстоящие события".
 */
import { getContext, extension_settings } from '/scripts/extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '/script.js';

const EN = 'rp-calendar';
const VER = '2.1.0';

// ── Системный промпт для LLM ──
const SYS_PROMPT = `[RP Calendar — Time & Events Tracking — STRICT FORMAT]
В САМОМ КОНЦЕ КАЖДОГО ответа ОБЯЗАТЕЛЬНО добавляй блок <datetime> ТОЧНО в этом формате:

<datetime>
date:YYYY/M/D
time:HH:MM
weather:краткое описание с эмодзи
</datetime>

ПРИМЕР:
<datetime>
date:2025/1/10
time:12:31
weather:☀️ Солнечно, прохладно
</datetime>

НЕЛЬЗЯ:
- писать "время: 2025/1/10" вместо блока <datetime>
- ставить блок в середине текста
- забывать закрывающий </datetime>
- менять имена полей (date/time/weather на русские)

═══════════════════════════════════════════════════════════
ПРЕДСТОЯЩИЕ СОБЫТИЯ (СТРОГО опционально — по умолчанию НЕ добавляй):
═══════════════════════════════════════════════════════════
🚫 НЕ ПРИДУМЫВАЙ события сам. НЕ навязывай игроку никаких планов, встреч, заданий, поручений и сюжетных крючков.
🚫 НЕ создавай событие "на всякий случай", "для атмосферы", "чтобы было интереснее" или "потому что персонаж мог бы захотеть".
🚫 Если в текущем сообщении НЕТ явного намерения от {{user}} или персонажа — блок <events> вообще НЕ выводи.

✅ Блок <events> добавляй ТОЛЬКО если в ТЕКУЩЕЙ сцене RP персонаж или {{user}} ЯВНО и в самом тексте:
  • прямо сказал что собирается что-то сделать ("завтра пойду к врачу", "вечером встретимся у моста")
  • договорился с кем-то о конкретной встрече/деле
  • получил конкретное задание/просьбу и согласился
  • дал явное обещание сделать что-то

❌ НЕ событие:
  • мимолётное настроение ("эх, надо бы отдохнуть")
  • абстрактные мечты ("когда-нибудь съезжу к морю")
  • то что персонаж ПРОСТО ПОДУМАЛ, но не озвучил/не решил
  • твои собственные идеи "куда бы развить сюжет"

Если ничего из этого в текущем сообщении не было — НЕ ВЫВОДИ блок <events>. Это нормально и правильно.

ФОРМАТ (используется только когда действительно надо):
<events>
add|название|дата|время|приоритет
done|название
remove|название
</events>

- add|название|дата|время|приоритет → добавить НОВОЕ дело (только если оно реально прозвучало в сцене)
- done|название → отметить выполненным, когда дело реально сделано в RP
- remove|название → удалить, если планы официально отменены в сцене

ПОЛЯ:
- название: короткое, до 60 символов, дословно отражает сказанное в RP
- дата: YYYY/M/D или пусто
- время: HH:MM или пусто
- приоритет: обычное | важное | срочное (по умолчанию — обычное)

ДОПОЛНИТЕЛЬНО:
- НЕ дублируй уже существующие события (они перечислены в системном контексте — сверяйся!)
- НЕ воссоздавай события, которые игрок отменил (они тоже перечислены)
- Лучше пропустить событие, чем выдумать лишнее. По умолчанию — НЕ выводи блок <events>.

═══════════════════════════════════════════════════════════
ПРАВИЛА ПРОДВИЖЕНИЯ ВРЕМЕНИ:
═══════════════════════════════════════════════════════════
- Если игрок указал конкретную дату/время — используй её точно.
- "Через несколько часов" → +2-4 часа. "На следующий день" → +1 день, 8:00.
- НЕ форсируй сюжет: не вводи новых NPC, не подкидывай "загадочные письма", не запускай квесты по своей инициативе. Следуй за {{user}}.
- Погода меняется не чаще раза в 6-12 часов RP-времени.
- Сезоны: зима (дек-фев), весна (мар-май), лето (июн-авг), осень (сен-ноя).
- Эмодзи погоды: ☀️ 🌧️ ❄️ ☁️ 🌨️ ⛈️ 🌫️ 🌪️

Блок <datetime>...</datetime> в КАЖДОМ ответе. Это критично.`;

// ── Дефолтные настройки ──
const DEFAULTS = {
    enabled: true,
    injectPrompt: true,
    startDate: '2025/1/1',
    startTime: '08:00',
    // Список вручную удалённых событий (нормализованные названия)
    // чтобы LLM не воссоздал их случайно
    manuallyRemoved: [],
    // Ручные переопределения статуса событий: { normalizedTitle: 'done' | 'removed' }
    manualOverrides: {},

    // ═════════════════ Система алмазов 💎 (как в Gardenscapes) ═════════════════
    gemsBalance: 0,                   // текущий баланс алмазов
    gemsAwarded: {},                  // { normTitle: количество } — уже выданные награды (защита от двойного начисления)
    gemsTotalEarned: 0,               // всего заработано за всё время (статистика)
    gemsTotalSpent: 0,                // всего потрачено
    gemsStreak: 0,                    // текущая серия выполненных подряд
    gemsLastDoneDate: '',             // дата последнего выполнения (для серии)
    gemsLog: [],                      // лог транзакций: [{t: timestamp, amount, reason, balance}]
    // Награды по приоритету (можно тюнить)
    gemsRewards: {
        'обычное': 10,
        'важное':  25,
        'срочное': 50,
        'overdue_penalty': 0,         // штраф за просрочку (0 = выкл)
        'streak_bonus': 5,            // +5 алмазов за каждое в серии (3+)
        'streak_min': 3,              // с какой серии начинается бонус
    },

    // ═════════════════ Match-3 «три в ряд» 🎮 ═════════════════
    matchHighScore: 0,                // лучший счёт
    matchTotalPlays: 0,               // всего сыграно партий
    matchTotalGems: 0,                // алмазов выиграно за всё время
};

let S = {};
function loadS() {
    S = extension_settings[EN] ? { ...DEFAULTS, ...extension_settings[EN] } : { ...DEFAULTS };
    extension_settings[EN] = S;
    // Стартовый приветственный бонус для новых пользователей (только при самом первом запуске)
    if (!S.welcomeBonusGiven) {
        S.welcomeBonusGiven = true;
        if (!S.gemsBalance) S.gemsBalance = 0;
        if (!S.gemsTotalEarned) S.gemsTotalEarned = 0;
        const WELCOME = 50;
        S.gemsBalance += WELCOME;
        S.gemsTotalEarned += WELCOME;
        if (!Array.isArray(S.gemsLog)) S.gemsLog = [];
        S.gemsLog.push({
            t: Date.now(),
            amount: WELCOME,
            reason: '🎁 Приветственный бонус',
            balance: S.gemsBalance,
        });
        saveSettingsDebounced();
    }
}
function saveS() {
    extension_settings[EN] = S;
    saveSettingsDebounced();
}

// ── Константы ──
const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

const SEASONS = {
    winter: { key: 'winter', name: 'Зима', icon: '❄️', months: [11, 0, 1] },
    spring: { key: 'spring', name: 'Весна', icon: '🌸', months: [2, 3, 4] },
    summer: { key: 'summer', name: 'Лето', icon: '☀️', months: [5, 6, 7] },
    autumn: { key: 'autumn', name: 'Осень', icon: '🍂', months: [8, 9, 10] },
};

function getSeason(month) {
    for (const key of Object.keys(SEASONS)) {
        if (SEASONS[key].months.includes(month)) return SEASONS[key];
    }
    return SEASONS.winter;
}

// ── Нормализация названия для сравнения (защита от дублей) ──
function normalizeTitle(title) {
    if (!title) return '';
    return String(title)
        .toLowerCase()
        .replace(/[.,!?;:«»""''`()\[\]{}<>]/g, '') // убираем пунктуацию
        .replace(/\s+/g, ' ')                       // нормализуем пробелы
        .trim();
}

// ── Проверка сходства двух названий (защита от почти-дублей) ──
function titlesMatch(a, b) {
    const na = normalizeTitle(a);
    const nb = normalizeTitle(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    // Одно содержит другое (>= 70% длины)
    const shorter = na.length < nb.length ? na : nb;
    const longer = na.length < nb.length ? nb : na;
    if (shorter.length >= 6 && longer.includes(shorter) && shorter.length / longer.length >= 0.6) return true;
    return false;
}

// ═══════════════════════════════════════════════════════════
// 💎 СИСТЕМА АЛМАЗОВ (Gardenscapes-style)
// ═══════════════════════════════════════════════════════════

// 🎁 Каталог сценарных событий — игрок копит алмазы и «заказывает» у бота сцену.
// При покупке: списываются алмазы → заказ инжектится в системный промпт
// для следующего ответа LLM (бот разыгрывает событие в RP).
const GEM_SHOP = [
    // ─── 🏠 Быт / повседневность ───
    { id: 'cozy_evening', cat: 'slice', icon: '🛋️', name: 'Уютный вечер вдвоём',     price: 40,
      desc: 'Бот предложит спокойный вечер: чай, плед, разговор по душам.',
      prompt: 'Разыграй уютный спокойный вечер: персонаж сам инициирует тёплый домашний момент — чай/какао, плед, тихий разговор, маленькое признание или забота о {{user}}. Без конфликтов, мягкий тон.' },

    { id: 'cooking_together', cat: 'slice', icon: '🍳', name: 'Готовим вместе',        price: 50,
      desc: 'Сцена совместной готовки — забавный кулинарный момент.',
      prompt: 'Разыграй сцену совместной готовки {{user}} и персонажа: лёгкий хаос на кухне, перепачканная мука, смех, мелкие касания. Закончи готовым блюдом и совместной дегустацией.' },

    { id: 'rainy_day', cat: 'slice', icon: '🌧️', name: 'Дождливый день дома',         price: 35,
      desc: 'Бот сменит погоду на дождь и устроит ленивый день.',
      prompt: 'Смени погоду на дождь (отрази в <datetime> weather). Разыграй ленивый дождливый день дома: окно в каплях, тёплый напиток, неспешный разговор или совместное безделье с {{user}}.' },

    // ─── 💖 Романтика ───
    { id: 'date_walk', cat: 'romance', icon: '🌸', name: 'Романтическая прогулка',    price: 80,
      desc: 'Персонаж позовёт {{user}} на красивую прогулку.',
      prompt: 'Персонаж по своей инициативе зовёт {{user}} на романтическую прогулку (парк/набережная/закат — выбери уместно). Опиши атмосферу, флирт, лёгкие касания, искренний момент близости (без NSFW, если не задано иначе).' },

    { id: 'gift', cat: 'romance', icon: '🎁', name: 'Неожиданный подарок',            price: 70,
      desc: 'Персонаж приготовил {{user}} приятный сюрприз.',
      prompt: 'Персонаж дарит {{user}} небольшой, но осмысленный подарок (выбери уместный для их отношений и сеттинга). Опиши момент вручения, реакцию, эмоции. Подарок должен говорить о том, что персонаж замечает детали о {{user}}.' },

    { id: 'confession', cat: 'romance', icon: '💞', name: 'Откровенное признание',    price: 120,
      desc: 'Персонаж откроет свои чувства — глубокая эмоциональная сцена.',
      prompt: 'Персонаж решается на честное эмоциональное признание {{user}} (любовь, привязанность, страх потерять — что уместно по контексту). Сцена камерная, голос тихий, паузы, дрожь в голосе. Не торопи диалог.' },

    { id: 'kiss', cat: 'romance', icon: '💋', name: 'Первый/неожиданный поцелуй',     price: 150,
      desc: 'Бот разыграет волнительный момент поцелуя.',
      prompt: 'Разыграй волнительный момент поцелуя между персонажем и {{user}}. Подведи через напряжение, взгляд, паузу. Опиши ощущения, дыхание, последствия — без перехода в NSFW, если это не уместно по тону чата.' },

    // ─── ⚔️ Приключение / сюжет ───
    { id: 'mystery_letter', cat: 'adventure', icon: '✉️', name: 'Загадочное письмо',  price: 90,
      desc: 'Приходит анонимное письмо и завязка интриги.',
      prompt: 'Введи новый сюжетный крючок: {{user}} (или персонаж) получает анонимное письмо/записку с загадочным содержанием. Добавь это в <events> как новое важное дело. Опиши, как письмо попало, и реакцию персонажа.' },

    { id: 'stranger', cat: 'adventure', icon: '🕵️', name: 'Странный незнакомец',     price: 110,
      desc: 'В сцене появится загадочный новый персонаж.',
      prompt: 'Введи нового второстепенного NPC — загадочного незнакомца, который пересекается с {{user}} и персонажем. Дай ему голос, описание, мотив остаётся неясным. Это завязка для будущей сюжетной линии.' },

    { id: 'small_quest', cat: 'adventure', icon: '🗺️', name: 'Маленькое приключение', price: 140,
      desc: 'Бот предложит небольшую вылазку/задание.',
      prompt: 'Персонаж предлагает {{user}} небольшое приключение/вылазку (поход, поиск, мини-расследование — уместно по сеттингу). Добавь его в <events> как важное и начни первую сцену прямо сейчас.' },

    { id: 'danger', cat: 'adventure', icon: '⚠️', name: 'Внезапная опасность',        price: 180,
      desc: 'Резкий поворот: угроза, требующая действий.',
      prompt: 'Введи внезапную умеренную угрозу/опасность в текущую сцену (нападение, авария, природное явление — уместно). Дай {{user}} пространство для действий, не разрешай ситуацию сам — оставь развилку.' },

    // ─── 🎭 Драма / эмоции ───
    { id: 'flashback', cat: 'drama', icon: '🕰️', name: 'Воспоминание персонажа',     price: 60,
      desc: 'Бот раскроет фрагмент прошлого героя.',
      prompt: 'Вставь в ответ короткий флешбэк/воспоминание персонажа из его прошлого, раскрывающий важную грань характера или травмы. Чётко отдели курсивом или абзацем. Верни сцену в текущее время в конце ответа.' },

    { id: 'jealousy', cat: 'drama', icon: '😤', name: 'Сцена ревности',               price: 75,
      desc: 'Лёгкая ревность/напряжение между персонажами.',
      prompt: 'Разыграй сцену с лёгкой ревностью или напряжением между персонажем и {{user}} (повод выбери уместный). Не доводи до серьёзной ссоры — закончи примирением или открытым разговором.' },

    { id: 'argument', cat: 'drama', icon: '💢', name: 'Серьёзный разговор/ссора',     price: 100,
      desc: 'Конфликт, который сдвинет отношения с мёртвой точки.',
      prompt: 'Разыграй серьёзный конфликтный разговор между персонажем и {{user}}: накопившиеся обиды, повышенные тона, честность. Не завершай сцену примирением — оставь её открытой на реакцию {{user}}.' },

    { id: 'vulnerable', cat: 'drama', icon: '🥺', name: 'Уязвимая сторона героя',     price: 85,
      desc: 'Персонаж покажет слабость, которую обычно прячет.',
      prompt: 'Покажи уязвимую сторону персонажа: он/она роняет маску перед {{user}} (страх, усталость, слёзы — что уместно). Сцена тихая, без героики, с реальной потребностью в поддержке.' },

    // ─── ✨ Магия / необычное ───
    { id: 'dream', cat: 'magic', icon: '💭', name: 'Странный сон',                    price: 55,
      desc: 'Сцена сна с символическим смыслом.',
      prompt: 'Опиши странный символический сон (персонажа или {{user}} — выбери уместно). Атмосферный, метафоричный, оставляющий ощущение тревоги или предчувствия. После пробуждения — короткая реакция.' },

    { id: 'magic_moment', cat: 'magic', icon: '🌟', name: 'Маленькое чудо',           price: 90,
      desc: 'Что-то необъяснимо красивое случится в сцене.',
      prompt: 'Введи в сцену маленькое чудо/необычное явление (мерцание, совпадение, неожиданная встреча с животным, северное сияние — уместно по сеттингу). Мягкое, доброе, с эмоциональным резонансом.' },

    { id: 'fate', cat: 'magic', icon: '🔮', name: 'Знак судьбы',                      price: 130,
      desc: 'Введёт пророчество/предзнаменование в сюжет.',
      prompt: 'Введи в сюжет знак судьбы / предзнаменование / пророчество — то, что персонаж или {{user}} замечает и не может игнорировать. Добавь в <events> как важное событие-загадку для будущей разгадки.' },

    // ─── 🎉 Праздник ───
    { id: 'celebration', cat: 'fun', icon: '🎉', name: 'Маленький праздник',          price: 65,
      desc: 'Импровизированное торжество в сцене.',
      prompt: 'Устрой импровизированный маленький праздник (день рождения/годовщина/просто потому что — выбери повод). Торт/свечи/музыка, тёплая атмосфера, тосты или признания.' },

    { id: 'surprise_visitor', cat: 'fun', icon: '🚪', name: 'Гость на пороге',        price: 70,
      desc: 'В дверь постучат — неожиданный визитёр.',
      prompt: 'В дверь стучатся — приходит неожиданный визитёр (старый друг персонажа, родственник, посыльный — выбери уместно). Раскрой его через диалог и реакцию персонажа.' },
];

const SHOP_CATEGORIES = [
    { key: 'all',       label: 'Все',        icon: '🛒' },
    { key: 'slice',     label: 'Быт',        icon: '🏠' },
    { key: 'romance',   label: 'Романтика',  icon: '💖' },
    { key: 'adventure', label: 'Приключение',icon: '⚔️' },
    { key: 'drama',     label: 'Драма',      icon: '🎭' },
    { key: 'magic',     label: 'Чудеса',     icon: '✨' },
    { key: 'fun',       label: 'Веселье',    icon: '🎉' },
];
let currentShopCat = 'all';

// Активные эффекты от покупок (живут в S.gemsActiveEffects)
function getActiveEffects() {
    if (!S.gemsActiveEffects) S.gemsActiveEffects = {};
    return S.gemsActiveEffects;
}

// Сколько алмазов выдать за выполненное событие (старая логика — не используется)
function calcReward(ev) {
    const rewards = S.gemsRewards || DEFAULTS.gemsRewards;
    const prio = (ev.priority || 'обычное').toLowerCase();
    return rewards[prio] || rewards['обычное'] || 10;
}

// 💎 СКОЛЬКО АЛМАЗОВ СТОИТ ВЫПОЛНИТЬ СОБЫТИЕ
// Цена зависит от приоритета: обычное=10, важное=20, срочное=40
function calcEventCost(ev) {
    const prio = (ev.priority || 'обычное').toLowerCase();
    if (prio === 'срочное') return 40;
    if (prio === 'важное') return 20;
    return 10;
}

// Начислить алмазы (с защитой от дублей)
function awardGems(ev, reason) {
    if (!ev || ev.done !== true) return 0;
    const norm = ev.normTitle || normalizeTitle(ev.title);
    if (!norm) return 0;
    if (!S.gemsAwarded) S.gemsAwarded = {};
    // Уже выдавали за это событие — не начисляем повторно
    if (S.gemsAwarded[norm]) return 0;

    const amount = calcReward(ev);
    S.gemsAwarded[norm] = amount;
    S.gemsBalance = (S.gemsBalance || 0) + amount;
    S.gemsTotalEarned = (S.gemsTotalEarned || 0) + amount;
    S.gemsStreak = (S.gemsStreak || 0) + 1;
    S.gemsLastDoneDate = LS.date || '';

    // Уменьшаем счётчик «удачного дня»
    const fx = getActiveEffects();
    if (fx.lucky_day && fx.lucky_day > 0) {
        fx.lucky_day -= 1;
        if (fx.lucky_day <= 0) delete fx.lucky_day;
    }

    // Лог
    if (!Array.isArray(S.gemsLog)) S.gemsLog = [];
    S.gemsLog.push({
        t: Date.now(),
        amount: +amount,
        reason: reason || `Выполнено: ${ev.title}`,
        balance: S.gemsBalance,
    });
    if (S.gemsLog.length > 100) S.gemsLog = S.gemsLog.slice(-100);

    return amount;
}

// Отозвать награду (если событие сняли с «выполнено»)
function refundGems(ev) {
    const norm = ev.normTitle || normalizeTitle(ev.title);
    if (!norm || !S.gemsAwarded || !S.gemsAwarded[norm]) return 0;
    const amount = S.gemsAwarded[norm];
    delete S.gemsAwarded[norm];
    S.gemsBalance = Math.max(0, (S.gemsBalance || 0) - amount);
    S.gemsTotalEarned = Math.max(0, (S.gemsTotalEarned || 0) - amount);
    S.gemsStreak = Math.max(0, (S.gemsStreak || 0) - 1);
    if (Array.isArray(S.gemsLog)) {
        S.gemsLog.push({
            t: Date.now(),
            amount: -amount,
            reason: `Отмена: ${ev.title}`,
            balance: S.gemsBalance,
        });
    }
    return amount;
}

// Потратить алмазы (для магазина)
function spendGems(amount, reason) {
    if ((S.gemsBalance || 0) < amount) return false;
    S.gemsBalance -= amount;
    S.gemsTotalSpent = (S.gemsTotalSpent || 0) + amount;
    if (!Array.isArray(S.gemsLog)) S.gemsLog = [];
    S.gemsLog.push({
        t: Date.now(),
        amount: -amount,
        reason: reason || 'Покупка',
        balance: S.gemsBalance,
    });
    if (S.gemsLog.length > 100) S.gemsLog = S.gemsLog.slice(-100);
    return true;
}

// 🎁 Заказать сценарное событие — списываем алмазы, ставим заказ в очередь.
// Заказ инжектится в системный промпт следующего ответа LLM, бот разыгрывает сцену.
function buyShopItem(itemId) {
    const item = GEM_SHOP.find(i => i.id === itemId);
    if (!item) return { ok: false, msg: 'Событие не найдено' };
    if ((S.gemsBalance || 0) < item.price) {
        return { ok: false, msg: `Недостаточно 💎 (нужно ${item.price})` };
    }
    if (!spendGems(item.price, `🎁 Заказ: ${item.name}`)) {
        return { ok: false, msg: 'Не удалось списать алмазы' };
    }
    const fx = getActiveEffects();
    if (!Array.isArray(fx.pending_requests)) fx.pending_requests = [];
    fx.pending_requests.push({
        id: item.id,
        name: item.name,
        icon: item.icon,
        prompt: item.prompt,
        t: Date.now(),
        // Сколько ответов бота заказ ещё активен (живёт). Стартуем с 2 — даём боту 2 поста на разыгрыш.
        postsLeft: 2,
        // Уникальный ключ заказа (для удаления — нескольких одинаковых сцен)
        uid: `${item.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    });
    // Лимит — 3 одновременных заказа (чтобы LLM не разорвало)
    if (fx.pending_requests.length > 3) {
        fx.pending_requests = fx.pending_requests.slice(-3);
    }
    saveS();
    return { ok: true, msg: `🎁 «${item.name}» заказано! Бот разыграет в ближайших ответах.` };
}

// Удалить заказ вручную (по uid). Алмазы НЕ возвращаются — игрок сам отменил.
function cancelShopRequest(uid) {
    const fx = getActiveEffects();
    if (!Array.isArray(fx.pending_requests)) return false;
    const idx = fx.pending_requests.findIndex(r => r.uid === uid);
    if (idx < 0) return false;
    const removed = fx.pending_requests.splice(idx, 1)[0];
    if (!Array.isArray(S.gemsLog)) S.gemsLog = [];
    S.gemsLog.push({
        t: Date.now(),
        amount: 0,
        reason: `❌ Заказ отменён: ${removed.name}`,
        balance: S.gemsBalance || 0,
    });
    saveS();
    return true;
}

// Уменьшить счётчик постов у активных заказов после ответа ассистента.
// Заказы с postsLeft <= 0 удаляются.
function tickShopRequests() {
    const fx = getActiveEffects();
    if (!Array.isArray(fx.pending_requests) || fx.pending_requests.length === 0) return;
    const expired = [];
    fx.pending_requests = fx.pending_requests.filter(r => {
        // postsLeft может отсутствовать у старых заказов — считаем 1
        if (typeof r.postsLeft !== 'number') r.postsLeft = 1;
        r.postsLeft -= 1;
        if (r.postsLeft <= 0) {
            expired.push(r);
            return false;
        }
        return true;
    });
    if (expired.length > 0) {
        if (!Array.isArray(S.gemsLog)) S.gemsLog = [];
        for (const r of expired) {
            S.gemsLog.push({
                t: Date.now(),
                amount: 0,
                reason: `✓ Заказ сыгран: ${r.name}`,
                balance: S.gemsBalance || 0,
            });
        }
        saveS();
    } else {
        saveS();
    }
}

// Анимация летящего алмаза +N
function flyGemAnim(amount) {
    const widget = document.getElementById('rpcal-widget');
    const counter = document.getElementById('rpcal-gem-counter');
    if (!widget || !counter) return;

    const fly = document.createElement('div');
    fly.className = 'rpcal-gem-fly';
    fly.innerHTML = `💎 +${amount}`;
    widget.appendChild(fly);

    // Подсветка счётчика
    counter.classList.add('rpcal-gem-pop');
    setTimeout(() => counter.classList.remove('rpcal-gem-pop'), 600);

    setTimeout(() => fly.remove(), 1500);
}

// ── Класс погодной анимации ──
function getWeatherClass(weather) {
    if (!weather) return '';
    const w = weather.toLowerCase();
    const heavy = /сильн|обильн|густ|метел|вьюг|пург|ливен|шквал|heavy|blizzard|downpour/.test(w);
    if (/гроз|шторм|молни|thunder|storm/.test(w) || w.includes('⛈')) return 'storm';
    if (/снег|метел|вьюг|снежн|пург|snow|blizzard/.test(w) || w.includes('❄') || w.includes('🌨')) {
        return heavy ? 'snow snow-heavy' : 'snow';
    }
    if (/дожд|ливен|морос|rain|drizzle/.test(w) || w.includes('🌧') || w.includes('🌦')) {
        return heavy ? 'rain rain-heavy' : 'rain';
    }
    if (/туман|дымк|мгла|fog|mist|haze/.test(w) || w.includes('🌫')) return 'fog';
    if (/ветр|ветер|шквал|wind|gale/.test(w) || w.includes('🌬') || w.includes('🌪')) return 'wind';
    if (/облач|пасмур|хмур|cloud|overcast/.test(w) || w.includes('☁') || w.includes('⛅')) return 'cloudy';
    if (/солнеч|ясн|sunny|clear/.test(w) || w.includes('☀') || w.includes('🌞')) return 'sunny';
    return '';
}

// ── Генерация DOM-частиц для погодных анимаций ──
// CSS-стили лежат в style.css (.rpcal-rain-drop, .rpcal-snow-flake,
// .rpcal-cloud, .rpcal-fog-patch, .rpcal-wind-streak, .storm-flash).
// Эта функция полностью пересоздаёт содержимое контейнера .rpcal-weather-fx
// согласно текущему классу погоды.
function spawnWeatherParticles(elFx, wxClass) {
    if (!elFx) return;
    // Полная очистка предыдущих частиц
    elFx.innerHTML = '';

    const cls = (wxClass || '').toLowerCase();
    const rand = (min, max) => min + Math.random() * (max - min);

    const make = (className, styles) => {
        const d = document.createElement('div');
        d.className = className;
        if (styles) {
            for (const k of Object.keys(styles)) d.style.setProperty(k, styles[k]);
        }
        return d;
    };

    // ── ДОЖДЬ / ЛИВЕНЬ / ГРОЗА (последняя — дождь + молнии) ──
    if (cls.includes('rain') || cls.includes('storm')) {
        const heavy = cls.includes('heavy') || cls.includes('storm');
        const count = heavy ? 55 : 32;
        for (let i = 0; i < count; i++) {
            elFx.appendChild(make('rpcal-rain-drop', {
                '--left':  rand(-5, 105).toFixed(2) + '%',
                '--dur':   rand(0.45, heavy ? 0.7 : 0.95).toFixed(2) + 's',
                '--delay': (-rand(0, 1.2)).toFixed(2) + 's',
            }));
        }
        if (cls.includes('storm')) {
            // Молния — ребёнок-оверлей с классом storm-flash
            elFx.appendChild(make('storm-flash'));
        }
        return;
    }

    // ── СНЕГ / МЕТЕЛЬ ──
    if (cls.includes('snow')) {
        const heavy = cls.includes('heavy');
        const count = heavy ? 45 : 28;
        for (let i = 0; i < count; i++) {
            elFx.appendChild(make('rpcal-snow-flake', {
                '--left':  rand(-5, 105).toFixed(2) + '%',
                '--size':  rand(2, heavy ? 5.5 : 4).toFixed(1) + 'px',
                '--dur':   rand(5, heavy ? 8 : 10).toFixed(2) + 's',
                '--delay': (-rand(0, 6)).toFixed(2) + 's',
                '--drift': (rand(-25, 25)).toFixed(1) + 'px',
            }));
        }
        return;
    }

    // ── ТУМАН ──
    if (cls.includes('fog')) {
        for (let i = 0; i < 4; i++) {
            elFx.appendChild(make('rpcal-fog-patch', {
                '--top':   rand(10, 65).toFixed(0) + '%',
                '--w':     rand(140, 240).toFixed(0) + 'px',
                '--h':     rand(40, 70).toFixed(0) + 'px',
                '--dur':   rand(18, 32).toFixed(0) + 's',
                '--delay': (-rand(0, 20)).toFixed(1) + 's',
            }));
        }
        return;
    }

    // ── ВЕТЕР ──
    if (cls.includes('wind')) {
        for (let i = 0; i < 8; i++) {
            elFx.appendChild(make('rpcal-wind-streak', {
                '--top':   rand(15, 85).toFixed(0) + '%',
                '--w':     rand(40, 90).toFixed(0) + 'px',
                '--dur':   rand(1.8, 3.2).toFixed(2) + 's',
                '--delay': (-rand(0, 3)).toFixed(2) + 's',
            }));
        }
        return;
    }

    // ── ОБЛАЧНО ──
    if (cls.includes('cloudy')) {
        for (let i = 0; i < 5; i++) {
            elFx.appendChild(make('rpcal-cloud', {
                '--top':   rand(5, 55).toFixed(0) + '%',
                '--left':  rand(-40, 10).toFixed(0) + '%',
                '--w':     rand(80, 140).toFixed(0) + 'px',
                '--h':     rand(24, 40).toFixed(0) + 'px',
                '--alpha': rand(0.18, 0.32).toFixed(2),
                '--dur':   rand(35, 60).toFixed(0) + 's',
                '--delay': (-rand(0, 40)).toFixed(1) + 's',
            }));
        }
        return;
    }

    // ── СОЛНЦЕ ── у класса .sunny оформление через сам контейнер (см. CSS),
    // дополнительные частицы не нужны.
}

// ── Проверка наличия datetime ──
function hasDatetime(msg) {
    if (!msg) return false;
    if (/<datetime>[\s\S]*?<\/datetime>/i.test(msg)) return true;
    if (/(?:^|\s)(?:дата|date)\s*[:：]\s*\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/i.test(msg)) return true;
    if (/(?:^|\s)(?:время|time)\s*[:：]\s*\d{1,2}[:.]\d{1,2}/i.test(msg)) return true;
    if (/\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}[\s,]+\d{1,2}[:.]\d{1,2}/.test(msg)) return true;
    return false;
}

function parseDatetime(msg) {
    if (!msg) return null;
    const result = { date: '', time: '', weather: '' };

    const m = msg.match(/<datetime>([\s\S]*?)<\/datetime>/i);
    if (m) {
        const lines = m[1].split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
            const idx = line.indexOf(':');
            if (idx <= 0) continue;
            const k = line.substring(0, idx).trim().toLowerCase();
            const v = line.substring(idx + 1).trim();
            if (k === 'date' || k === 'дата') result.date = v;
            else if (k === 'time' || k === 'время') result.time = v;
            else if (k === 'weather' || k === 'погода') result.weather = v;
        }
    }

    if (!result.date) {
        const dm = msg.match(/(?:дата|date)\s*[:：]\s*(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/i);
        if (dm) result.date = dm[1].replace(/[\-\.]/g, '/');
    }
    if (!result.time) {
        const tm = msg.match(/(?:время|time)\s*[:：]\s*(\d{1,2}[:.]\d{1,2})/i);
        if (tm) result.time = tm[1].replace('.', ':');
    }
    if (!result.weather) {
        const wm = msg.match(/(?:погода|weather)\s*[:：]\s*([^\n<>]+)/i);
        if (wm) result.weather = wm[1].trim().substring(0, 60);
    }

    if (!result.date || !result.time) {
        const both = msg.match(/(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})[\s,]+(\d{1,2}[:.]\d{1,2})/);
        if (both) {
            if (!result.date) result.date = both[1].replace(/[\-\.]/g, '/');
            if (!result.time) result.time = both[2].replace('.', ':');
        }
    }

    if (!result.date && !result.time) return null;
    return result;
}

// ── Парсинг блока <events> ──
// Возвращает массив операций: [{op:'add'|'done'|'remove', title, date, time, priority}]
function parseEvents(msg) {
    if (!msg) return [];
    const m = msg.match(/<events>([\s\S]*?)<\/events>/i);
    if (!m) return [];
    const ops = [];
    const lines = m[1].split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length < 2) continue;
        const op = parts[0].toLowerCase();
        if (op === 'add') {
            const title = parts[1];
            if (!title) continue;
            ops.push({
                op: 'add',
                title,
                date: parts[2] || '',
                time: parts[3] || '',
                priority: (parts[4] || 'обычное').toLowerCase(),
            });
        } else if (op === 'done' || op === 'complete' || op === 'completed') {
            ops.push({ op: 'done', title: parts[1] });
        } else if (op === 'remove' || op === 'delete' || op === 'cancel') {
            ops.push({ op: 'remove', title: parts[1] });
        }
    }
    return ops;
}

// ── Парсинг строки даты ──
function parseDateStr(dateStr, timeStr) {
    if (!dateStr) return null;
    const dm = dateStr.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (!dm) return null;
    const y = +dm[1], mo = +dm[2], d = +dm[3];
    let h = 0, mi = 0;
    if (timeStr) {
        const tm = timeStr.match(/(\d{1,2}):(\d{1,2})/);
        if (tm) { h = +tm[1]; mi = +tm[2]; }
    }
    return new Date(y, mo - 1, d, h, mi);
}

// ── Скрыть теги из отображения ──
function ensureRegex() {
    try {
        const ctx = getContext();
        const regex = ctx?.extensionSettings?.regex;
        if (!Array.isArray(regex)) return;

        const items = [
            {
                id: 'rpcal_hide_datetime',
                scriptName: 'RP Calendar — hide <datetime>',
                findRegex: '/<datetime>[\\s\\S]*?<\\/datetime>/gim',
            },
            {
                id: 'rpcal_hide_events',
                scriptName: 'RP Calendar — hide <events>',
                findRegex: '/<events>[\\s\\S]*?<\\/events>/gim',
            },
        ];

        for (const it of items) {
            if (regex.some(r => r.id === it.id)) continue;
            regex.push({
                id: it.id,
                scriptName: it.scriptName,
                findRegex: it.findRegex,
                replaceString: '',
                trimStrings: [],
                placement: [2],
                disabled: false,
                markdownOnly: true,
                promptOnly: false,
                runOnEdit: true,
                substituteRegex: 0,
                minDepth: null,
                maxDepth: null,
            });
        }
    } catch (e) {
        console.warn('[RP Calendar] ensureRegex failed:', e);
    }
}

// ── Агрегация: пробежать чат и собрать дату/время/события ──
let LS = { date: '', time: '', weather: '' };
let EVENTS = []; // [{id, title, date, time, priority, done, addedAt}]

function agg() {
    const chat = getContext()?.chat || [];
    const result = { date: S.startDate, time: S.startTime, weather: '' };
    const events = []; // Список текущих активных + выполненных
    const removedSet = new Set((S.manuallyRemoved || []).map(t => normalizeTitle(t)));
    const overrides = S.manualOverrides || {};

    for (let i = 0; i < chat.length; i++) {
        const meta = chat[i].rpcal_meta;
        if (meta) {
            if (meta.date) result.date = meta.date;
            if (meta.time) result.time = meta.time;
            if (meta.weather) result.weather = meta.weather;
        }
        const ops = chat[i].rpcal_events;
        if (Array.isArray(ops)) {
            const ctxDate = result.date;
            const ctxTime = result.time;
            for (const op of ops) {
                if (op.op === 'add') {
                    const title = (op.title || '').trim();
                    if (!title) continue;
                    const norm = normalizeTitle(title);
                    // Пропускаем, если пользователь его удалил вручную
                    if (removedSet.has(norm)) continue;
                    // Защита от дублей — ищем любое (включая done)
                    const dup = events.find(e => titlesMatch(e.title, title));
                    if (dup) {
                        // Если LLM пришлёт более полные данные — обновим
                        if (!dup.date && op.date) dup.date = op.date;
                        if (!dup.time && op.time) dup.time = op.time;
                        if (op.priority && op.priority !== 'обычное') dup.priority = op.priority;
                        continue;
                    }
                    events.push({
                        id: `${i}_${events.length}_${Date.now()}`,
                        title,
                        normTitle: norm,
                        date: op.date || '',
                        time: op.time || '',
                        priority: op.priority || 'обычное',
                        done: false,
                        addedAt: `${ctxDate} ${ctxTime}`,
                        msgIdx: i,
                    });
                } else if (op.op === 'done') {
                    const ev = events.find(e => titlesMatch(e.title, op.title) && !e.done);
                    if (ev) ev.done = true;
                } else if (op.op === 'remove') {
                    const idx = events.findIndex(e => titlesMatch(e.title, op.title));
                    if (idx >= 0) events.splice(idx, 1);
                }
            }
        }
    }

    // Применяем ручные переопределения
    for (const ev of events) {
        const ov = overrides[ev.normTitle || normalizeTitle(ev.title)];
        if (ov === 'done') ev.done = true;
    }

    EVENTS = events;

    // 💎 Алмазы СПИСЫВАЮТСЯ за выполнение события (см. manualToggleDone).
    // Здесь — только защита: если событие исчезло из чата, забываем флаг траты.
    if (!S.gemsSpentOn) S.gemsSpentOn = {};
    const validNorms = new Set(events.map(e => e.normTitle || normalizeTitle(e.title)));
    for (const norm of Object.keys(S.gemsSpentOn)) {
        if (!validNorms.has(norm)) delete S.gemsSpentOn[norm];
    }

    return result;
}

// ── Текущая дата ──
function currentDate() {
    return parseDateStr(LS.date, LS.time) || new Date();
}

// ── Сравнение дат событий с текущей ──
function eventDateValue(ev) {
    const d = parseDateStr(ev.date, ev.time);
    if (d) return d.getTime();
    return Number.MAX_SAFE_INTEGER; // без даты — в конец
}
function getOverdueClass(ev) {
    if (ev.done) return 'done';
    const evD = parseDateStr(ev.date, ev.time);
    if (!evD) return '';
    const now = currentDate();
    if (evD.getTime() < now.getTime()) return 'overdue';
    const diffH = (evD.getTime() - now.getTime()) / 3600000;
    if (diffH < 24) return 'soon';
    return '';
}

// ── События чата ──
function onMessage(idx) {
    if (!S.enabled) return;
    const chat = getContext()?.chat;
    if (!chat || idx < 0 || idx >= chat.length) return;
    const msg = chat[idx].mes;
    let changed = false;

    if (hasDatetime(msg)) {
        const parsed = parseDatetime(msg);
        if (parsed) {
            chat[idx].rpcal_meta = parsed;
            changed = true;
        }
    }
    const ops = parseEvents(msg);
    if (ops.length > 0) {
        chat[idx].rpcal_events = ops;
        changed = true;
    }

    if (changed) {
        LS = agg();
        renderWidget();
        try { getContext().saveChat?.(); } catch (_) {}
    }
}

function onChatChanged(force) {
    if (!S.enabled) return;
    const chat = getContext()?.chat || [];
    for (let i = 0; i < chat.length; i++) {
        if (!chat[i].mes) continue;
        if ((force || !chat[i].rpcal_meta) && hasDatetime(chat[i].mes)) {
            const p = parseDatetime(chat[i].mes);
            if (p) chat[i].rpcal_meta = p;
        }
        if (force || !chat[i].rpcal_events) {
            const ops = parseEvents(chat[i].mes);
            if (ops.length > 0) chat[i].rpcal_events = ops;
        }
    }
    LS = agg();
    renderWidget();
}

function onPromptReady(ed) {
    if (!S.enabled || !S.injectPrompt) return;
    if (!ed?.chat) return;
    ed.chat.unshift({ role: 'system', content: SYS_PROMPT });

    // Инжектим текущее состояние + активные события + удалённые
    const activeEvents = EVENTS.filter(e => !e.done);
    let ctxStr = `[RP Calendar — текущее время: ${LS.date} ${LS.time}${LS.weather ? ' | ' + LS.weather : ''}]`;

    // 💎 Информация про алмазы — для LLM
    const balance = S.gemsBalance || 0;
    const streak = S.gemsStreak || 0;
    ctxStr += `\n[RP Calendar 💎 Алмазы у игрока: ${balance}]`;
    ctxStr += `\n[RP Calendar — игрок ТРАТИТ алмазы, чтобы выполнить событие (обычное=10💎, важное=20💎, срочное=40💎). Ты создаёшь события — игрок решает, какие из них «прокачать» алмазами. Не упоминай алмазы в RP — это мета-механика интерфейса.]`;

    if (activeEvents.length > 0) {
        const lines = activeEvents.slice(0, 15).map(e => {
            const when = e.date ? `${e.date}${e.time ? ' ' + e.time : ''}` : 'когда-нибудь';
            return `• ${e.title} (${when}, ${e.priority})`;
        });
        ctxStr += `\n[RP Calendar — активные события персонажа (НЕ дублируй их!)]:\n${lines.join('\n')}`;
    }
    // Сообщаем LLM про удалённые игроком события — чтобы не воссоздавал
    if (Array.isArray(S.manuallyRemoved) && S.manuallyRemoved.length > 0) {
        const removed = S.manuallyRemoved.slice(-10);
        ctxStr += `\n[RP Calendar — отменённые игроком события, НЕ создавай их снова]:\n${removed.map(t => '• ' + t).join('\n')}`;
    }

    // 🎁 Заказанные игроком сцены — сильный инжект, бот разыгрывает в ближайших ответах
    const fx = getActiveEffects();
    if (Array.isArray(fx.pending_requests) && fx.pending_requests.length > 0) {
        const reqs = fx.pending_requests.map((r, i) => {
            const ord = fx.pending_requests.length > 1 ? `${i + 1}) ` : '';
            const promptText = r.prompt || `Разыграй сцену: ${r.name}`;
            return `${ord}${r.icon || '🎁'} ${r.name}\n   ${promptText}`;
        });
        ctxStr += `\n\n═══════════════════════════════════════════════════════════\n`
              + `[RP Calendar 🎁 — ИГРОК ЗАКАЗАЛ СЦЕНУ (за алмазы)]\n`
              + `Это ПРИОРИТЕТНОЕ указание. Разыграй заказанное событие ОРГАНИЧНО в этом ответе или\n`
              + `в ближайшем следующем — вплетая его в текущий контекст RP. Сохрани голос и характер.\n`
              + `Не упоминай «алмазы», «магазин», «заказ» в самом тексте сцены — это мета.\n\n`
              + `${reqs.join('\n\n')}\n`
              + `═══════════════════════════════════════════════════════════`;
        // НЕ очищаем заказы сразу — они истекут через N постов через tickShopRequests()
        // на событие CHARACTER_MESSAGE_RENDERED.
    }
    if (fx.lucky_day && fx.lucky_day > 0) {
        ctxStr += `\n[RP Calendar 🍀 — активен «Удачный день»: x2 наград за ${fx.lucky_day} событий]`;
    }

    let insertIdx = ed.chat.length - 1;
    for (let i = ed.chat.length - 1; i >= 0; i--) {
        if (ed.chat[i].role === 'user') { insertIdx = i; break; }
    }
    ed.chat.splice(insertIdx, 0, { role: 'system', content: ctxStr });
}

// ── Ручные действия с событиями ──
function manualRemoveEvent(normTitle, title) {
    if (!normTitle) normTitle = normalizeTitle(title);
    if (!normTitle) return;
    if (!Array.isArray(S.manuallyRemoved)) S.manuallyRemoved = [];
    // Сохраняем оригинальное название (для отображения и для LLM)
    const original = title || normTitle;
    if (!S.manuallyRemoved.some(t => normalizeTitle(t) === normTitle)) {
        S.manuallyRemoved.push(original);
        // Лимит — храним последние 50
        if (S.manuallyRemoved.length > 50) {
            S.manuallyRemoved = S.manuallyRemoved.slice(-50);
        }
    }
    if (S.manualOverrides) delete S.manualOverrides[normTitle];
    saveS();
    LS = agg();
    renderWidget();
}

// 💎 Игрок ТРАТИТ алмазы, чтобы выполнить событие.
// При снятии отметки — алмазы возвращаются.
function manualToggleDone(normTitle, title) {
    if (!normTitle) normTitle = normalizeTitle(title);
    if (!normTitle) return;
    if (!S.manualOverrides) S.manualOverrides = {};
    if (!S.gemsSpentOn) S.gemsSpentOn = {};
    const ev = EVENTS.find(e => (e.normTitle || normalizeTitle(e.title)) === normTitle);
    if (!ev) return;

    if (ev.done) {
        // ── СНИМАЕМ ОТМЕТКУ → возвращаем алмазы
        delete S.manualOverrides[normTitle];
        const spent = S.gemsSpentOn[normTitle];
        if (spent && spent > 0) {
            S.gemsBalance = (S.gemsBalance || 0) + spent;
            S.gemsTotalSpent = Math.max(0, (S.gemsTotalSpent || 0) - spent);
            if (!Array.isArray(S.gemsLog)) S.gemsLog = [];
            S.gemsLog.push({
                t: Date.now(),
                amount: +spent,
                reason: `Отмена выполнения: ${ev.title}`,
                balance: S.gemsBalance,
            });
            delete S.gemsSpentOn[normTitle];
        }
    } else {
        // ── ОТМЕЧАЕМ ВЫПОЛНЕННЫМ → списываем алмазы
        const cost = calcEventCost(ev);
        const balance = S.gemsBalance || 0;
        if (balance < cost) {
            // Недостаточно — показываем тост и выходим
            try {
                const toast = document.getElementById('rpcal-shop-toast');
                if (toast) {
                    toast.textContent = `Недостаточно 💎 (нужно ${cost}, есть ${balance})`;
                    toast.className = 'rpcal-shop-toast show err';
                    setTimeout(() => { toast.className = 'rpcal-shop-toast'; }, 2200);
                }
            } catch (_) {}
            return;
        }
        if (!spendGems(cost, `✓ Выполнено: ${ev.title}`)) return;
        S.gemsSpentOn[normTitle] = cost;
        S.manualOverrides[normTitle] = 'done';
        // Маленькая «пожирающая» анимация — пусть счётчик подмигнёт
        try {
            const counter = document.getElementById('rpcal-gem-counter');
            if (counter) {
                counter.classList.add('rpcal-gem-pop');
                setTimeout(() => counter.classList.remove('rpcal-gem-pop'), 500);
            }
        } catch (_) {}
    }
    saveS();
    LS = agg();
    renderWidget();
}

function manualRestoreRemoved(title) {
    if (!Array.isArray(S.manuallyRemoved)) return;
    const norm = normalizeTitle(title);
    S.manuallyRemoved = S.manuallyRemoved.filter(t => normalizeTitle(t) !== norm);
    saveS();
    LS = agg();
    renderWidget();
}

// ── UI ──
let cY = 2025, cM = 1;
let currentTab = 'calendar'; // 'calendar' | 'events'

function createUI() {
    if (document.getElementById('rpcal-drawer')) return;

    const holder = document.getElementById('top-settings-holder');
    if (!holder) {
        setTimeout(createUI, 500);
        return;
    }

    const wrap = document.createElement('div');
    wrap.id = 'rpcal-drawer';
    wrap.className = 'rpcal-wrapper';
    wrap.innerHTML = `
        <div id="rpcal-icon" class="rpcal-icon" title="RP Calendar">
            <i class="fa-solid fa-calendar-days"></i>
            <span id="rpcal-icon-badge" class="rpcal-icon-badge">1</span>
        </div>
        <div id="rpcal-widget" class="rpcal-widget" data-season="winter" style="display:none;">
            <div id="rpcal-gem-counter" class="rpcal-gem-counter" title="Алмазы">
                <span class="rpcal-gem-icon">💎</span>
                <span id="rpcal-gem-amount" class="rpcal-gem-amount">0</span>
            </div>
            <div class="rpcal-header">
                <div id="rpcal-weather-fx" class="rpcal-weather-fx"></div>
                <div id="rpcal-time" class="rpcal-time">08:00</div>
                <div id="rpcal-fulldate" class="rpcal-fulldate">1 января 2025</div>
                <div id="rpcal-weekday" class="rpcal-weekday">Среда</div>
            </div>
            <div class="rpcal-tabs">
                <button class="rpcal-tab active" data-tab="calendar">
                    <i class="fa-solid fa-calendar"></i> Календарь
                </button>
                <button class="rpcal-tab" data-tab="events">
                    <i class="fa-solid fa-list-check"></i> События
                    <span id="rpcal-events-badge" class="rpcal-tab-badge" style="display:none;">0</span>
                </button>
                <button class="rpcal-tab" data-tab="games">
                    <i class="fa-solid fa-gamepad"></i> Игры
                </button>
            </div>
            <div id="rpcal-tab-calendar" class="rpcal-tab-content active">
                <div class="rpcal-info">
                    <div class="rpcal-info-row">
                        <span class="rpcal-info-label">Сезон:</span>
                        <span id="rpcal-season" class="rpcal-info-value">❄️ Зима</span>
                    </div>
                    <div class="rpcal-info-row">
                        <span class="rpcal-info-label">Погода:</span>
                        <span id="rpcal-weather" class="rpcal-info-value">—</span>
                    </div>
                </div>
                <div class="rpcal-cal-nav">
                    <button id="rpcal-cal-prev" class="rpcal-btn"><i class="fa-solid fa-chevron-left"></i></button>
                    <span id="rpcal-cal-title">Январь 2025</span>
                    <button id="rpcal-cal-next" class="rpcal-btn"><i class="fa-solid fa-chevron-right"></i></button>
                </div>
                <div id="rpcal-grid" class="rpcal-grid"></div>
                <div class="rpcal-footer">
                    <small>Время обновляется автоматически по тегу &lt;datetime&gt;</small>
                </div>
            </div>
            <div id="rpcal-tab-events" class="rpcal-tab-content">
                <div class="rpcal-actions-panel">
                    <div class="rpcal-actions-header">
                        <div class="rpcal-actions-balance">
                            <span class="rpcal-gem-icon-big">💎</span>
                            <span id="rpcal-shop-balance-amount">0</span>
                            <small class="rpcal-actions-stats">
                                ↑<span id="rpcal-shop-earned">0</span>
                                ↓<span id="rpcal-shop-spent">0</span>
                            </small>
                        </div>
                        <button id="rpcal-actions-toggle" class="rpcal-actions-toggle" title="Заказать у бота сценарное событие за алмазы">
                            <i class="fa-solid fa-gift"></i> Заказать событие
                        </button>
                    </div>
                    <div id="rpcal-shop-list" class="rpcal-shop-list rpcal-actions-list" style="display:none;"></div>
                    <div id="rpcal-shop-toast" class="rpcal-shop-toast"></div>
                </div>
                <div class="rpcal-events-filters">
                    <button class="rpcal-filter active" data-filter="active">Активные</button>
                    <button class="rpcal-filter" data-filter="done">Выполненные</button>
                    <button class="rpcal-filter" data-filter="all">Все</button>
                </div>
                <div id="rpcal-events-list" class="rpcal-events-list"></div>
                <div class="rpcal-footer">
                    <small>💎 Алмазы тратятся на «✓ Выполнить» (обычное=10, важное=20, срочное=40). Зарабатывайте их в игре «Три в ряд» или заказывайте у бота сцены.</small>
                </div>
            </div>
            <div id="rpcal-tab-games" class="rpcal-tab-content">
                <div class="rpcal-games-header">
                    <h3 class="rpcal-games-title"><i class="fa-solid fa-gamepad"></i> Коллекция игр</h3>
                    <small class="rpcal-games-sub">Выберите игру — она откроется здесь же, во вкладке.</small>
                </div>
                <div id="rpcal-games-list-wrap" class="rpcal-games-list-wrap">
                    <div id="rpcal-games-grid" class="rpcal-games-list"></div>
                </div>
                <div id="rpcal-games-host-wrap" class="rpcal-games-host-wrap" style="display:none;">
                    <button id="rpcal-games-back" class="rpcal-games-back" type="button">
                        <i class="fa-solid fa-arrow-left"></i> К списку игр
                    </button>
                    <div id="rpcal-games-host" class="rpcal-games-host"></div>
                    <div id="rpcal-m3-wrap" class="rpcal-games-section" style="display:none;">
                        <h4 class="rpcal-games-subtitle">💎 Три в ряд</h4>
                        <div class="rpcal-m3-header">
                            <div class="rpcal-m3-stat" title="Счёт">
                                <span class="rpcal-m3-stat-label">Счёт</span>
                                <span id="rpcal-m3-score" class="rpcal-m3-stat-val">0</span>
                            </div>
                            <div class="rpcal-m3-stat" title="Осталось ходов">
                                <span class="rpcal-m3-stat-label">Ходы</span>
                                <span id="rpcal-m3-moves" class="rpcal-m3-stat-val">0</span>
                            </div>
                            <div class="rpcal-m3-stat" title="Рекорд">
                                <span class="rpcal-m3-stat-label">🏆 Рекорд</span>
                                <span id="rpcal-m3-best" class="rpcal-m3-stat-val">0</span>
                            </div>
                            <div class="rpcal-m3-stat" title="Алмазы">
                                <span class="rpcal-m3-stat-label">💎</span>
                                <span id="rpcal-m3-gems" class="rpcal-m3-stat-val">0</span>
                            </div>
                        </div>
                        <div id="rpcal-m3-board" class="rpcal-m3-board"></div>
                        <div id="rpcal-m3-rewards" class="rpcal-m3-rewards"></div>
                        <div class="rpcal-m3-controls">
                            <button id="rpcal-m3-start" class="rpcal-m3-btn primary">
                                <i class="fa-solid fa-play"></i> Играть
                            </button>
                            <button id="rpcal-m3-shuffle" class="rpcal-m3-btn" disabled>
                                <i class="fa-solid fa-shuffle"></i> Перемешать
                            </button>
                        </div>
                        <div id="rpcal-m3-toast" class="rpcal-m3-toast"></div>
                        <div class="rpcal-footer">
                            <small>Собирайте 3+ фишек в ряд. Награды каждые 50 очков.</small>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    holder.appendChild(wrap);

    const icon = document.getElementById('rpcal-icon');
    const widget = document.getElementById('rpcal-widget');

    icon.addEventListener('click', (e) => {
        e.stopPropagation();
        if (widget.style.display === 'none') {
            const d = currentDate();
            cY = d.getFullYear();
            cM = d.getMonth() + 1;
            renderWidget();
            widget.style.display = 'block';
        } else {
            widget.style.display = 'none';
        }
    });

    document.addEventListener('click', (e) => {
        if (widget.style.display === 'none') return;
        let t = e.target;
        while (t && t !== document) {
            if (t.id === 'rpcal-drawer') return;
            t = t.parentElement;
        }
        widget.style.display = 'none';
    });

    document.getElementById('rpcal-cal-prev').addEventListener('click', (e) => {
        e.stopPropagation();
        cM--;
        if (cM < 1) { cM = 12; cY--; }
        renderCalendar();
    });
    document.getElementById('rpcal-cal-next').addEventListener('click', (e) => {
        e.stopPropagation();
        cM++;
        if (cM > 12) { cM = 1; cY++; }
        renderCalendar();
    });

    // Переключение вкладок
    widget.querySelectorAll('.rpcal-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const tab = btn.dataset.tab;
            currentTab = tab;
            widget.querySelectorAll('.rpcal-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
            widget.querySelectorAll('.rpcal-tab-content').forEach(c => {
                c.classList.toggle('active', c.id === `rpcal-tab-${tab}`);
            });
            if (tab === 'events') renderEvents();
            if (tab === 'shop')   renderShop();
            if (tab === 'games')  { renderGamesList(); }
        });
    });

    // Фильтры событий
    widget.querySelectorAll('.rpcal-filter').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            widget.querySelectorAll('.rpcal-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderEvents();
        });
    });

    // Кнопка-аккордеон «Бонусы» — раскрывает список покупок (бывший магазин)
    const actionsToggle = document.getElementById('rpcal-actions-toggle');
    const actionsList = document.getElementById('rpcal-shop-list');
    if (actionsToggle && actionsList) {
        actionsToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = actionsList.style.display !== 'none';
            actionsList.style.display = open ? 'none' : '';
            actionsToggle.classList.toggle('open', !open);
            if (!open) renderShop();
        });
    }

    renderWidget();
}

function renderWidget() {
    const d = currentDate();
    const season = getSeason(d.getMonth());

    const badge = document.getElementById('rpcal-icon-badge');
    if (badge) badge.textContent = String(d.getDate());

    const widget = document.getElementById('rpcal-widget');
    if (!widget) return;

    widget.setAttribute('data-season', season.key);

    const elTime = document.getElementById('rpcal-time');
    const elDate = document.getElementById('rpcal-fulldate');
    const elWday = document.getElementById('rpcal-weekday');
    const elSeason = document.getElementById('rpcal-season');
    const elWeather = document.getElementById('rpcal-weather');
    const elFx = document.getElementById('rpcal-weather-fx');

    if (elTime) elTime.textContent = LS.time || '—:—';
    if (elDate) elDate.textContent = `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
    if (elWday) elWday.textContent = WEEKDAYS[d.getDay()];
    if (elSeason) elSeason.textContent = `${season.icon} ${season.name}`;
    if (elWeather) elWeather.textContent = LS.weather || '—';

    if (elFx) {
        let wxClass = getWeatherClass(LS.weather);
        if (!wxClass) {
            wxClass = season.key === 'winter' ? 'snow'
                   : season.key === 'autumn' ? 'cloudy'
                   : season.key === 'spring' ? 'cloudy'
                   : 'sunny';
        }
        const newClass = 'rpcal-weather-fx ' + wxClass;
        // Пересоздаём частицы только если класс реально сменился
        // (иначе анимации сбрасывались бы при каждой перерисовке).
        if (elFx.className !== newClass) {
            elFx.className = newClass;
            spawnWeatherParticles(elFx, wxClass);
        } else if (!elFx.firstChild) {
            // На случай если контейнер пуст — перегенерируем
            spawnWeatherParticles(elFx, wxClass);
        }
    }

    // Бэйдж событий
    const evBadge = document.getElementById('rpcal-events-badge');
    if (evBadge) {
        const activeCount = EVENTS.filter(e => !e.done).length;
        if (activeCount > 0) {
            evBadge.textContent = String(activeCount);
            evBadge.style.display = '';
        } else {
            evBadge.style.display = 'none';
        }
    }

    // 💎 Обновляем счётчик алмазов
    const gemAmt = document.getElementById('rpcal-gem-amount');
    if (gemAmt) gemAmt.textContent = String(S.gemsBalance || 0);

    cY = d.getFullYear();
    cM = d.getMonth() + 1;
    renderCalendar();
    if (currentTab === 'events') renderEvents();
    if (currentTab === 'shop')   renderShop();
}

// ── Рендер каталога сценарных событий ──
function renderShop() {
    const list = document.getElementById('rpcal-shop-list');
    if (!list) return;

    const balEl = document.getElementById('rpcal-shop-balance-amount');
    const earnedEl = document.getElementById('rpcal-shop-earned');
    const spentEl = document.getElementById('rpcal-shop-spent');
    if (balEl) balEl.textContent = String(S.gemsBalance || 0);
    if (earnedEl) earnedEl.textContent = String(S.gemsTotalEarned || 0);
    if (spentEl) spentEl.textContent = String(S.gemsTotalSpent || 0);

    const balance = S.gemsBalance || 0;
    const fx = getActiveEffects();
    const pending = Array.isArray(fx.pending_requests) ? fx.pending_requests : [];
    const pendingIds = new Set(pending.map(r => r.id));

    // ── Активные заказы (если есть) — шапка с кнопками удаления и счётчиком постов
    let html = '';
    if (pending.length > 0) {
        html += `<div class="rpcal-shop-pending">
            <div class="rpcal-shop-pending-title">🎁 Заказано (бот разыграет в ближайших ответах):</div>
            ${pending.map(r => {
                const left = typeof r.postsLeft === 'number' ? r.postsLeft : 1;
                const leftLabel = left > 0 ? `<span class="rpcal-shop-pending-left" title="Осталось постов до автоудаления">⏳ ${left}</span>` : '';
                return `<div class="rpcal-shop-pending-item" data-uid="${escapeHtml(r.uid || '')}">
                    <span class="rpcal-shop-pending-icon">${r.icon || '🎁'}</span>
                    <span class="rpcal-shop-pending-name">${escapeHtml(r.name)}</span>
                    ${leftLabel}
                    <button class="rpcal-shop-pending-cancel" title="Отменить заказ (алмазы не возвращаются)" data-uid="${escapeHtml(r.uid || '')}">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>`;
            }).join('')}
        </div>`;
    }

    // ── Чипы категорий
    html += `<div class="rpcal-shop-cats">`;
    for (const cat of SHOP_CATEGORIES) {
        const count = cat.key === 'all'
            ? GEM_SHOP.length
            : GEM_SHOP.filter(i => i.cat === cat.key).length;
        html += `<button class="rpcal-shop-cat ${currentShopCat === cat.key ? 'active' : ''}" data-cat="${cat.key}">
            ${cat.icon} ${cat.label} <span class="rpcal-shop-cat-count">${count}</span>
        </button>`;
    }
    html += `</div>`;

    // ── Карточки событий
    const items = currentShopCat === 'all'
        ? GEM_SHOP
        : GEM_SHOP.filter(i => i.cat === currentShopCat);

    html += `<div class="rpcal-shop-items">`;
    for (const item of items) {
        const canBuy = balance >= item.price;
        const isPending = pendingIds.has(item.id);
        const badge = isPending ? `<span class="rpcal-shop-badge active">🎁 заказано</span>` : '';
        html += `
            <div class="rpcal-shop-item ${canBuy ? '' : 'disabled'} ${isPending ? 'pending' : ''}" data-id="${item.id}">
                <div class="rpcal-shop-item-icon">${item.icon}</div>
                <div class="rpcal-shop-item-body">
                    <div class="rpcal-shop-item-name">${escapeHtml(item.name)} ${badge}</div>
                    <div class="rpcal-shop-item-desc">${escapeHtml(item.desc)}</div>
                </div>
                <button class="rpcal-shop-item-buy" ${canBuy ? '' : 'disabled'} title="${canBuy ? 'Заказать у бота' : 'Недостаточно алмазов'}">
                    <span class="rpcal-gem-icon">💎</span>
                    <span>${item.price}</span>
                </button>
            </div>
        `;
    }
    html += `</div>`;

    list.innerHTML = html;

    // Обработчики чипов категорий
    list.querySelectorAll('.rpcal-shop-cat').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            currentShopCat = btn.getAttribute('data-cat') || 'all';
            renderShop();
        });
    });

    // Обработчики «✕ отменить заказ»
    list.querySelectorAll('.rpcal-shop-pending-cancel').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const uid = btn.getAttribute('data-uid');
            if (!uid) return;
            if (cancelShopRequest(uid)) {
                showShopToast('Заказ отменён', true);
                renderShop();
            }
        });
    });

    // Обработчики кнопок «купить»
    list.querySelectorAll('.rpcal-shop-item').forEach(card => {
        const btn = card.querySelector('.rpcal-shop-item-buy');
        if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = card.getAttribute('data-id');
            const res = buyShopItem(id);
            showShopToast(res.msg, res.ok);
            renderShop();
            renderWidget();
        });
    });
}

function showShopToast(msg, ok) {
    const toast = document.getElementById('rpcal-shop-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'rpcal-shop-toast show ' + (ok ? 'ok' : 'err');
    clearTimeout(showShopToast._t);
    showShopToast._t = setTimeout(() => {
        toast.className = 'rpcal-shop-toast';
    }, 2000);
}

function renderCalendar() {
    const titleEl = document.getElementById('rpcal-cal-title');
    const grid = document.getElementById('rpcal-grid');
    if (!grid || !titleEl) return;

    titleEl.textContent = `${MONTHS_NOM[cM - 1]} ${cY}`;

    const firstDay = new Date(cY, cM - 1, 1);
    const daysInMonth = new Date(cY, cM, 0).getDate();
    let startWeekday = firstDay.getDay() - 1;
    if (startWeekday < 0) startWeekday = 6;

    const cur = currentDate();
    const isCurMonth = cur.getFullYear() === cY && (cur.getMonth() + 1) === cM;
    const curDay = isCurMonth ? cur.getDate() : -1;

    // Метки событий по дням
    const dayEvents = {};
    for (const ev of EVENTS) {
        if (ev.done) continue;
        const ed = parseDateStr(ev.date, ev.time);
        if (!ed) continue;
        if (ed.getFullYear() === cY && (ed.getMonth() + 1) === cM) {
            const dn = ed.getDate();
            dayEvents[dn] = (dayEvents[dn] || 0) + 1;
        }
    }

    let html = '';
    for (const wd of WEEKDAYS_SHORT.slice(1).concat(WEEKDAYS_SHORT[0])) {
        html += `<div class="rpcal-grid-header">${wd}</div>`;
    }
    for (let i = 0; i < startWeekday; i++) {
        html += '<div class="rpcal-grid-day empty"></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const classes = ['rpcal-grid-day'];
        if (d === curDay) classes.push('current');
        if (dayEvents[d]) classes.push('has-event');
        const dot = dayEvents[d] ? '<span class="rpcal-day-dot"></span>' : '';
        html += `<div class="${classes.join(' ')}">${d}${dot}</div>`;
    }
    grid.innerHTML = html;
}

function renderEvents() {
    const list = document.getElementById('rpcal-events-list');
    if (!list) return;

    const widget = document.getElementById('rpcal-widget');
    const activeFilter = widget?.querySelector('.rpcal-filter.active')?.dataset.filter || 'active';

    let items = [...EVENTS];
    if (activeFilter === 'active') items = items.filter(e => !e.done);
    else if (activeFilter === 'done') items = items.filter(e => e.done);

    // Сортировка: по дате (без даты в конец), невыполненные сначала
    items.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return eventDateValue(a) - eventDateValue(b);
    });

    if (items.length === 0) {
        list.innerHTML = `
            <div class="rpcal-events-empty">
                <i class="fa-solid fa-calendar-check"></i>
                <p>Нет событий</p>
                <small>События появятся, когда персонаж запланирует что-то</small>
            </div>
        `;
        return;
    }

    let html = '';
    for (const ev of items) {
        const overdue = getOverdueClass(ev);
        const prio = ev.priority || 'обычное';
        const whenStr = ev.date
            ? `${ev.date}${ev.time ? ' • ' + ev.time : ''}`
            : 'когда-нибудь';
        const prioIcon = prio === 'срочное' ? '🔴' : prio === 'важное' ? '🟡' : '🟢';
        const norm = ev.normTitle || normalizeTitle(ev.title);
        const cost = calcEventCost(ev);
        const balanceNow = S.gemsBalance || 0;
        const canAfford = balanceNow >= cost;

        // Кнопка «Выполнить»: показывает цену 💎; блокируется, если не хватает
        let doneBtnHtml;
        if (ev.done) {
            doneBtnHtml = `<button class="rpcal-event-btn rpcal-ev-done refund" title="Отменить выполнение (вернуть ${cost} 💎)">
                        <i class="fa-solid fa-rotate-left"></i>
                    </button>`;
        } else {
            doneBtnHtml = `<button class="rpcal-event-btn rpcal-ev-done rpcal-ev-pay${canAfford ? '' : ' disabled'}"
                        title="${canAfford ? `Выполнить за ${cost} 💎` : `Нужно ${cost} 💎 (есть ${balanceNow})`}"
                        ${canAfford ? '' : 'disabled'}>
                        <i class="fa-solid fa-check"></i>
                        <span class="rpcal-ev-price"><span class="rpcal-gem-icon">💎</span>${cost}</span>
                    </button>`;
        }

        html += `
            <div class="rpcal-event ${overdue} prio-${prio}" data-norm="${escapeHtml(norm)}" data-title="${escapeHtml(ev.title)}">
                <div class="rpcal-event-prio">${prioIcon}</div>
                <div class="rpcal-event-body">
                    <div class="rpcal-event-title">${escapeHtml(ev.title)}</div>
                    <div class="rpcal-event-meta">
                        <span class="rpcal-event-when"><i class="fa-solid fa-clock"></i> ${escapeHtml(whenStr)}</span>
                        ${ev.done ? '<span class="rpcal-event-status done">✓ выполнено</span>' : ''}
                        ${overdue === 'overdue' && !ev.done ? '<span class="rpcal-event-status overdue">просрочено</span>' : ''}
                        ${overdue === 'soon' && !ev.done ? '<span class="rpcal-event-status soon">скоро</span>' : ''}
                    </div>
                </div>
                <div class="rpcal-event-actions">
                    ${doneBtnHtml}
                    <button class="rpcal-event-btn rpcal-ev-remove" title="Удалить (отменить)">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }
    list.innerHTML = html;

    // Привязываем обработчики
    list.querySelectorAll('.rpcal-event').forEach(card => {
        const norm = card.getAttribute('data-norm') || '';
        const title = card.getAttribute('data-title') || '';
        const btnDone = card.querySelector('.rpcal-ev-done');
        const btnRem = card.querySelector('.rpcal-ev-remove');
        if (btnDone) {
            btnDone.addEventListener('click', (e) => {
                e.stopPropagation();
                manualToggleDone(norm, title);
            });
        }
        if (btnRem) {
            btnRem.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Удалить событие «${title}»?\nLLM не будет создавать его снова.`)) {
                    manualRemoveEvent(norm, title);
                }
            });
        }
    });
}

// ═══════════════════════════════════════════════════════════
// 🎮 MATCH-3 — мини-игра «три в ряд»
// ═══════════════════════════════════════════════════════════
const M3_COLS = 7;
const M3_ROWS = 7;
// Картинки фруктов для плиток (файлы лежат в svg/ рядом с расширением)
const M3_TYPES = ['1', '2', '3', '4', '5', '6', '7'];
// Базовый URL вычисляется относительно текущего модуля,
// чтобы корректно работать независимо от имени папки расширения и базового пути ST.
const M3_IMG_BASE = new URL('./svg/', import.meta.url).href;
function m3TileHTML(t, extraClass = '') {
    const name = M3_TYPES[t];
    return `<span class="rpcal-m3-tile ${extraClass}" data-type="${t}">`
         + `<img class="rpcal-m3-img" src="${M3_IMG_BASE}${name}.png" alt="${name}" draggable="false">`
         + `</span>`;
}
// Match-3 — бесплатная мини-игра для фарма алмазов (стоимость 0, чтобы баланс не уходил в минус).
const M3_PRICE = 0;           // стоимость попытки (бесплатно)
const M3_SHUFFLE_PRICE = 0;   // стоимость перемешивания (бесплатно)
const M3_MOVES = 20;          // ходов в партии
const M3_REWARDS = [
    { score: 50,  gems: 5,  label: '+5 💎' },
    { score: 100, gems: 15, label: '+15 💎' },
    { score: 200, gems: 40, label: '+40 💎' },
    { score: 350, gems: 80, label: '+80 💎' },
];

const M3 = {
    board: [],          // двумерный массив типов (number 0..5) или null
    score: 0,
    moves: 0,
    active: false,      // партия идёт
    busy: false,        // блок ввода (идёт анимация)
    selected: null,     // {r,c}
    rewardsClaimed: [], // [score] — уже выданные пороги
};

function m3RandType() {
    return Math.floor(Math.random() * M3_TYPES.length);
}

// Заполнить поле без начальных совпадений
function m3GenerateBoard() {
    const b = [];
    for (let r = 0; r < M3_ROWS; r++) {
        b.push([]);
        for (let c = 0; c < M3_COLS; c++) {
            let t;
            let tries = 0;
            do {
                t = m3RandType();
                tries++;
                // не более 2 одинаковых подряд
                const horiz = c >= 2 && b[r][c - 1] === t && b[r][c - 2] === t;
                const vert  = r >= 2 && b[r - 1][c] === t && b[r - 2][c] === t;
                if (!horiz && !vert) break;
            } while (tries < 20);
            b[r].push(t);
        }
    }
    return b;
}

// Найти все совпадения (>=3) → массив групп [{r,c}, ...]
function m3FindMatches(b) {
    const matched = Array.from({ length: M3_ROWS }, () => Array(M3_COLS).fill(false));
    // горизонтали
    for (let r = 0; r < M3_ROWS; r++) {
        let run = 1;
        for (let c = 1; c <= M3_COLS; c++) {
            if (c < M3_COLS && b[r][c] !== null && b[r][c] === b[r][c - 1]) {
                run++;
            } else {
                if (run >= 3) {
                    for (let k = 0; k < run; k++) matched[r][c - 1 - k] = true;
                }
                run = 1;
            }
        }
    }
    // вертикали
    for (let c = 0; c < M3_COLS; c++) {
        let run = 1;
        for (let r = 1; r <= M3_ROWS; r++) {
            if (r < M3_ROWS && b[r][c] !== null && b[r][c] === b[r - 1][c]) {
                run++;
            } else {
                if (run >= 3) {
                    for (let k = 0; k < run; k++) matched[r - 1 - k][c] = true;
                }
                run = 1;
            }
        }
    }
    const cells = [];
    for (let r = 0; r < M3_ROWS; r++) {
        for (let c = 0; c < M3_COLS; c++) {
            if (matched[r][c]) cells.push({ r, c });
        }
    }
    return cells;
}

// Применить гравитацию + рефилл
function m3CollapseAndRefill(b) {
    for (let c = 0; c < M3_COLS; c++) {
        const col = [];
        for (let r = 0; r < M3_ROWS; r++) {
            if (b[r][c] !== null) col.push(b[r][c]);
        }
        while (col.length < M3_ROWS) col.unshift(m3RandType());
        for (let r = 0; r < M3_ROWS; r++) b[r][c] = col[r];
    }
}

// Проверить, есть ли хоть один возможный ход
function m3HasMoves(b) {
    for (let r = 0; r < M3_ROWS; r++) {
        for (let c = 0; c < M3_COLS; c++) {
            // попробуем свап вправо
            if (c + 1 < M3_COLS) {
                [b[r][c], b[r][c + 1]] = [b[r][c + 1], b[r][c]];
                const found = m3FindMatches(b).length > 0;
                [b[r][c], b[r][c + 1]] = [b[r][c + 1], b[r][c]];
                if (found) return true;
            }
            // попробуем свап вниз
            if (r + 1 < M3_ROWS) {
                [b[r][c], b[r + 1][c]] = [b[r + 1][c], b[r][c]];
                const found = m3FindMatches(b).length > 0;
                [b[r][c], b[r + 1][c]] = [b[r + 1][c], b[r][c]];
                if (found) return true;
            }
        }
    }
    return false;
}

// Рендер всего поля
function m3RenderBoard() {
    const board = document.getElementById('rpcal-m3-board');
    if (!board) return;
    board.innerHTML = '';
    board.style.setProperty('--m3-cols', M3_COLS);
    board.style.setProperty('--m3-rows', M3_ROWS);

    for (let r = 0; r < M3_ROWS; r++) {
        for (let c = 0; c < M3_COLS; c++) {
            const t = M3.board[r] && M3.board[r][c];
            const cell = document.createElement('div');
            cell.className = 'rpcal-m3-cell';
            cell.dataset.r = r;
            cell.dataset.c = c;
            if (t !== null && t !== undefined) {
                cell.innerHTML = m3TileHTML(t);
            }
            if (M3.selected && M3.selected.r === r && M3.selected.c === c) {
                cell.classList.add('selected');
            }
            board.appendChild(cell);
        }
    }
}

function m3UpdateStats() {
    const sc = document.getElementById('rpcal-m3-score');
    const mv = document.getElementById('rpcal-m3-moves');
    const bs = document.getElementById('rpcal-m3-best');
    const gm = document.getElementById('rpcal-m3-gems');
    if (sc) sc.textContent = String(M3.score);
    if (mv) mv.textContent = String(M3.moves);
    if (bs) bs.textContent = String(S.matchHighScore || 0);
    if (gm) gm.textContent = String(S.gemsBalance || 0);

    const startBtn = document.getElementById('rpcal-m3-start');
    const shufBtn  = document.getElementById('rpcal-m3-shuffle');
    if (startBtn) {
        if (M3.active) {
            startBtn.innerHTML = `<i class="fa-solid fa-flag-checkered"></i> Сдаться`;
            startBtn.classList.remove('primary');
        } else {
            startBtn.innerHTML = `<i class="fa-solid fa-play"></i> Играть`;
            startBtn.classList.add('primary');
            startBtn.disabled = false;
        }
    }
    if (shufBtn) {
        shufBtn.disabled = !M3.active;
    }

    // Рендер наград
    const rew = document.getElementById('rpcal-m3-rewards');
    if (rew) {
        let html = '';
        for (const t of M3_REWARDS) {
            const got = M3.rewardsClaimed.includes(t.score);
            const ready = M3.score >= t.score && !got;
            html += `<div class="rpcal-m3-reward ${got ? 'claimed' : ''} ${ready ? 'ready' : ''}" title="Награда за ${t.score} очков">
                <span class="rpcal-m3-reward-score">${t.score}</span>
                <span class="rpcal-m3-reward-gems">${t.label}</span>
                ${got ? '<i class="fa-solid fa-check"></i>' : ''}
            </div>`;
        }
        rew.innerHTML = html;
    }
}

function showM3Toast(msg, ok) {
    const toast = document.getElementById('rpcal-m3-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'rpcal-m3-toast show ' + (ok ? 'ok' : 'err');
    clearTimeout(showM3Toast._t);
    showM3Toast._t = setTimeout(() => {
        toast.className = 'rpcal-m3-toast';
    }, 2200);
}

// Проверка и выдача наград
function m3CheckRewards() {
    let totalGems = 0;
    for (const t of M3_REWARDS) {
        if (M3.score >= t.score && !M3.rewardsClaimed.includes(t.score)) {
            M3.rewardsClaimed.push(t.score);
            totalGems += t.gems;
        }
    }
    if (totalGems > 0) {
        S.gemsBalance = (S.gemsBalance || 0) + totalGems;
        S.gemsTotalEarned = (S.gemsTotalEarned || 0) + totalGems;
        S.matchTotalGems = (S.matchTotalGems || 0) + totalGems;
        if (!Array.isArray(S.gemsLog)) S.gemsLog = [];
        S.gemsLog.push({
            t: Date.now(),
            amount: totalGems,
            reason: `Match-3: рубеж ${M3.score} очков`,
            balance: S.gemsBalance,
        });
        saveS();
        flyGemAnim(totalGems);
        showM3Toast(`🎉 Награда! +${totalGems} 💎`, true);
    }
}

// Свап двух соседних клеток с обработкой
async function m3TrySwap(r1, c1, r2, c2) {
    if (M3.busy) return;
    if (!M3.active) {
        showM3Toast('Нажмите «Играть» чтобы начать партию', false);
        return;
    }
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return;
    if (r1 < 0 || r1 >= M3_ROWS || c1 < 0 || c1 >= M3_COLS) return;
    if (r2 < 0 || r2 >= M3_ROWS || c2 < 0 || c2 >= M3_COLS) return;

    M3.busy = true;
    try {
        const b = M3.board;
        [b[r1][c1], b[r2][c2]] = [b[r2][c2], b[r1][c1]];
        m3RenderBoard();
        await m3Wait(180);

        const matches = m3FindMatches(b);
        if (matches.length === 0) {
            // откатываем
            [b[r1][c1], b[r2][c2]] = [b[r2][c2], b[r1][c1]];
            m3RenderBoard();
            return;
        }

        // Удачный ход
        M3.moves--;
        await m3ResolveBoard();

        // Конец партии?
        if (M3.moves <= 0) {
            m3EndGame('Ходы закончились');
        } else if (!m3HasMoves(M3.board)) {
            showM3Toast('Нет ходов — перемешиваем!', true);
            await m3Wait(400);
            M3.board = m3GenerateBoard();
            m3RenderBoard();
        }

        m3UpdateStats();
    } catch (err) {
        console.error('[RP Calendar] m3TrySwap error:', err);
    } finally {
        M3.busy = false;
    }
}

// Каскадное удаление + гравитация + проверка наград
async function m3ResolveBoard() {
    let combo = 0;
    while (true) {
        const matches = m3FindMatches(M3.board);
        if (matches.length === 0) break;
        combo++;
        // Подсчёт очков: 3 = 1pt, 4 = 3pt, 5+ = 6pt + комбо-множитель
        let pts = 0;
        // Сгруппируем по линиям грубо — просто по числу совпавших клеток
        const sz = matches.length;
        if (sz <= 3) pts = 3;
        else if (sz <= 5) pts = 8;
        else pts = 15;
        pts *= combo; // комбо-множитель
        M3.score += pts;

        // Анимация исчезновения
        for (const { r, c } of matches) {
            M3.board[r][c] = null;
        }
        m3RenderBoardWithMatches(matches);
        await m3Wait(280);

        // Гравитация
        m3CollapseAndRefill(M3.board);
        m3RenderBoardFalling();
        await m3Wait(220);

        m3UpdateStats();
        m3CheckRewards();
    }
}

// Рендер с подсветкой совпавших ячеек (для анимации исчезания)
function m3RenderBoardWithMatches(matches) {
    const board = document.getElementById('rpcal-m3-board');
    if (!board) return;
    const set = new Set(matches.map(m => `${m.r}_${m.c}`));
    board.innerHTML = '';
    for (let r = 0; r < M3_ROWS; r++) {
        for (let c = 0; c < M3_COLS; c++) {
            const t = M3.board[r] && M3.board[r][c];
            const cell = document.createElement('div');
            cell.className = 'rpcal-m3-cell';
            cell.dataset.r = r;
            cell.dataset.c = c;
            const isMatch = set.has(`${r}_${c}`) || t === null || t === undefined;
            if (t !== null && t !== undefined) {
                cell.innerHTML = m3TileHTML(t, isMatch ? 'matching' : '');
            }
            board.appendChild(cell);
        }
    }
}

function m3RenderBoardFalling() {
    const board = document.getElementById('rpcal-m3-board');
    if (!board) return;
    board.innerHTML = '';
    for (let r = 0; r < M3_ROWS; r++) {
        for (let c = 0; c < M3_COLS; c++) {
            const t = M3.board[r][c];
            const cell = document.createElement('div');
            cell.className = 'rpcal-m3-cell';
            cell.dataset.r = r;
            cell.dataset.c = c;
            cell.innerHTML = m3TileHTML(t, 'falling');
            board.appendChild(cell);
        }
    }
}

function m3Wait(ms) {
    return new Promise(res => setTimeout(res, ms));
}

function m3StartGame() {
    if (M3.active) {
        // Сдаться
        m3EndGame('Партия завершена');
        return;
    }
    // Match-3 теперь бесплатная — игрок фармит алмазы за награды.
    M3.board = m3GenerateBoard();
    M3.score = 0;
    M3.moves = M3_MOVES;
    M3.active = true;
    M3.selected = null;
    M3.rewardsClaimed = [];
    S.matchTotalPlays = (S.matchTotalPlays || 0) + 1;
    saveS();
    m3RenderBoard();
    m3UpdateStats();
    showM3Toast('Поехали! У вас ' + M3_MOVES + ' ходов', true);
    renderWidget();
}

function m3EndGame(reason) {
    M3.active = false;
    M3.selected = null;
    if (M3.score > (S.matchHighScore || 0)) {
        S.matchHighScore = M3.score;
        showM3Toast(`🏆 Новый рекорд: ${M3.score}!`, true);
    } else {
        showM3Toast(`${reason}. Счёт: ${M3.score}`, true);
    }
    saveS();
    m3UpdateStats();
    renderWidget();
}

function m3Shuffle() {
    if (!M3.active || M3.busy) return;
    // Перемешивание тоже бесплатное.
    M3.board = m3GenerateBoard();
    m3RenderBoard();
    m3UpdateStats();
    showM3Toast('🔀 Поле перемешано', true);
    renderWidget();
}

// Главный рендер вкладки + обработчики (вызывается каждый раз при открытии)
function renderMatch3() {
    if (!M3.board.length) {
        // Декоративное превью-поле
        M3.board = m3GenerateBoard();
    }
    m3RenderBoard();
    m3UpdateStats();

    const board = document.getElementById('rpcal-m3-board');
    const startBtn = document.getElementById('rpcal-m3-start');
    const shufBtn  = document.getElementById('rpcal-m3-shuffle');

    if (startBtn && !startBtn._bound) {
        startBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            m3StartGame();
        });
        startBtn._bound = true;
    }
    if (shufBtn && !shufBtn._bound) {
        shufBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            m3Shuffle();
        });
        shufBtn._bound = true;
    }

    if (board && !board._bound) {
        // Mouse + touch: клик-клик с подсветкой выбранной клетки
        let dragStart = null;

        const getCellFromEvent = (ev) => {
            const target = ev.target.closest('.rpcal-m3-cell');
            if (!target) return null;
            return { r: +target.dataset.r, c: +target.dataset.c };
        };

        board.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!M3.active || M3.busy) return;
            const cell = getCellFromEvent(e);
            if (!cell) return;
            if (!M3.selected) {
                M3.selected = cell;
                m3RenderBoard();
                return;
            }
            const a = M3.selected;
            const b = cell;
            // тот же клик — снимаем выделение
            if (a.r === b.r && a.c === b.c) {
                M3.selected = null;
                m3RenderBoard();
                return;
            }
            // не сосед — переключаем выделение
            if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) {
                M3.selected = cell;
                m3RenderBoard();
                return;
            }
            M3.selected = null;
            m3TrySwap(a.r, a.c, b.r, b.c);
        });

        // Drag swap (mouse)
        board.addEventListener('mousedown', (e) => {
            if (!M3.active || M3.busy) return;
            const cell = getCellFromEvent(e);
            if (cell) dragStart = { ...cell, x: e.clientX, y: e.clientY };
        });
        board.addEventListener('mouseup', (e) => {
            if (!dragStart || !M3.active || M3.busy) { dragStart = null; return; }
            const dx = e.clientX - dragStart.x;
            const dy = e.clientY - dragStart.y;
            if (Math.abs(dx) < 15 && Math.abs(dy) < 15) { dragStart = null; return; }
            let r2 = dragStart.r, c2 = dragStart.c;
            if (Math.abs(dx) > Math.abs(dy)) c2 += dx > 0 ? 1 : -1;
            else                              r2 += dy > 0 ? 1 : -1;
            if (r2 < 0 || r2 >= M3_ROWS || c2 < 0 || c2 >= M3_COLS) { dragStart = null; return; }
            M3.selected = null;
            m3TrySwap(dragStart.r, dragStart.c, r2, c2);
            dragStart = null;
        });

        // Touch drag
        board.addEventListener('touchstart', (e) => {
            if (!M3.active || M3.busy) return;
            const t = e.touches[0];
            const target = document.elementFromPoint(t.clientX, t.clientY);
            const cellEl = target && target.closest('.rpcal-m3-cell');
            if (cellEl) dragStart = { r: +cellEl.dataset.r, c: +cellEl.dataset.c, x: t.clientX, y: t.clientY };
        }, { passive: true });
        board.addEventListener('touchend', (e) => {
            if (!dragStart || !M3.active || M3.busy) { dragStart = null; return; }
            const t = e.changedTouches[0];
            const dx = t.clientX - dragStart.x;
            const dy = t.clientY - dragStart.y;
            if (Math.abs(dx) < 15 && Math.abs(dy) < 15) { dragStart = null; return; }
            let r2 = dragStart.r, c2 = dragStart.c;
            if (Math.abs(dx) > Math.abs(dy)) c2 += dx > 0 ? 1 : -1;
            else                              r2 += dy > 0 ? 1 : -1;
            if (r2 < 0 || r2 >= M3_ROWS || c2 < 0 || c2 >= M3_COLS) { dragStart = null; return; }
            M3.selected = null;
            m3TrySwap(dragStart.r, dragStart.c, r2, c2);
            dragStart = null;
        });

        board._bound = true;
    }
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════
// 🎮 КОЛЛЕКЦИЯ ИГР (интеграция GameCollection)
// ═══════════════════════════════════════════════════════════
const EXT_GAMES_BASE = new URL('./games/', import.meta.url).href;

// Локальный fallback-список (используется до загрузки games.js)
const FALLBACK_GAMES = [
    { id: 'blockblast',  icon: '⬛', name: 'Block Blast'  },
    { id: 'minesweeper', icon: '💣', name: 'Сапёр'        },
    { id: 'game2048',    icon: '🔢', name: '2048'         },
    { id: 'memory',      icon: '🃏', name: 'Мемори'       },
    { id: 'mahjong',     icon: '🀄', name: 'Маджонг'      },
    { id: 'flappybird',  icon: '🐦', name: 'Flappy Bird'  },
    { id: 'sudoku',      icon: '🧩', name: 'Судоку'       },
];

let _gamesLoaded = false;
let _gamesLoading = null;

function loadGameCollection() {
    if (_gamesLoaded) return Promise.resolve(true);
    if (_gamesLoading) return _gamesLoading;

    _gamesLoading = (async () => {
        // CSS
        try {
            if (!document.getElementById('rpcal-games-css')) {
                const link = document.createElement('link');
                link.id = 'rpcal-games-css';
                link.rel = 'stylesheet';
                link.href = EXT_GAMES_BASE + 'games.css';
                document.head.appendChild(link);
            }
        } catch (e) { console.warn('[RP Calendar] games.css load failed:', e); }

        // Скрываем плавающую FAB-кнопку самой коллекции (мы открываем игры из вкладки)
        try {
            if (!document.getElementById('rpcal-games-hide-fab')) {
                const st = document.createElement('style');
                st.id = 'rpcal-games-hide-fab';
                st.textContent = '.bb-btn{display:none !important;}';
                document.head.appendChild(st);
            }
        } catch (_) {}

        // JS — как ES-модуль
        try {
            await import(EXT_GAMES_BASE + 'games.js');
            _gamesLoaded = true;
            return true;
        } catch (e) {
            console.error('[RP Calendar] games.js load failed:', e);
            return false;
        }
    })();

    return _gamesLoading;
}

// ── Селекторы панелей игр (из games.js) ──
// games.js создаёт DOM-узлы прямо в document.body. Чтобы встроить их в нашу вкладку,
// мы запоминаем их оригинальное место и переносим в #rpcal-games-host при открытии.
// ВАЖНО: у всех игр базовый класс .bb-panel + модификатор. Block Blast — без модификатора,
// поэтому селектор более узкий (исключаем элементы с другими модификаторами).
const GAME_PANEL_SELECTORS = {
    blockblast:  '.bb-panel:not(.ms-panel):not(.g2048-panel):not(.mem-panel):not(.fb-panel):not(.su-panel):not(.mj-panel)',
    minesweeper: '.ms-panel',
    game2048:    '.g2048-panel',
    memory:      '.mem-panel',
    mahjong:     '.mj-panel',
    flappybird:  '.fb-panel',
    sudoku:      '.su-panel',
};

// Сохранённые оригинальные места панелей: { selector: { parent, nextSibling } }
const _gamePanelOrigin = {};
let _currentGamePanel = null;

function ejectGamePanel() {
    // Возвращаем активную панель обратно в её оригинальное место и закрываем
    if (!_currentGamePanel) return;
    try {
        _currentGamePanel.classList.remove('open');
        // Закрываем все панели через API (на всякий случай — освобождаем таймеры/циклы)
        if (window.GameCollection && typeof window.GameCollection.close === 'function') {
            try { window.GameCollection.close(); } catch (_) {}
        }
        const sel = _currentGamePanel.dataset.rpcalSel;
        const origin = sel && _gamePanelOrigin[sel];
        if (origin && origin.parent) {
            if (origin.nextSibling && origin.nextSibling.parentNode === origin.parent) {
                origin.parent.insertBefore(_currentGamePanel, origin.nextSibling);
            } else {
                origin.parent.appendChild(_currentGamePanel);
            }
        }
    } catch (e) {
        console.warn('[RP Calendar] ejectGamePanel error:', e);
    }
    _currentGamePanel = null;
}

function injectGamePanel(id) {
    const sel = GAME_PANEL_SELECTORS[id];
    if (!sel) return false;
    const panel = document.querySelector(sel);
    const host = document.getElementById('rpcal-games-host');
    if (!panel || !host) return false;

    // Запомним оригинальное место (один раз)
    if (!_gamePanelOrigin[sel]) {
        _gamePanelOrigin[sel] = {
            parent: panel.parentNode,
            nextSibling: panel.nextSibling,
        };
        panel.dataset.rpcalSel = sel;
    }

    // Перенос внутрь хоста
    host.appendChild(panel);
    panel.classList.add('open', 'rpcal-embedded');
    _currentGamePanel = panel;
    return true;
}

// Иконки для игр в списке. Используем Font Awesome — гарантированно в палитре темы.
const GAME_ICONS = {
    match3:      'fa-solid fa-gem',
    blockblast:  'fa-solid fa-cubes',
    minesweeper: 'fa-solid fa-bomb',
    game2048:    'fa-solid fa-table-cells',
    memory:      'fa-solid fa-clone',
    mahjong:     'fa-solid fa-dice',
    flappybird:  'fa-solid fa-dove',
    sudoku:      'fa-solid fa-puzzle-piece',
};

function gameIconHTML(id) {
    const cls = GAME_ICONS[id] || 'fa-solid fa-gamepad';
    return `<i class="${cls}"></i>`;
}

function showGamesList() {
    const listWrap = document.getElementById('rpcal-games-list-wrap');
    const hostWrap = document.getElementById('rpcal-games-host-wrap');
    const m3Wrap   = document.getElementById('rpcal-m3-wrap');
    const host     = document.getElementById('rpcal-games-host');
    ejectGamePanel();
    if (m3Wrap) m3Wrap.style.display = 'none';
    if (host)   host.style.display = '';
    if (hostWrap) hostWrap.style.display = 'none';
    if (listWrap) listWrap.style.display = '';
}

function showMatch3InTab() {
    const listWrap = document.getElementById('rpcal-games-list-wrap');
    const hostWrap = document.getElementById('rpcal-games-host-wrap');
    const m3Wrap   = document.getElementById('rpcal-m3-wrap');
    const host     = document.getElementById('rpcal-games-host');
    // Возвращаем чужую игру (если была) и скрываем её хост
    ejectGamePanel();
    if (host)   host.style.display = 'none';
    if (m3Wrap) m3Wrap.style.display = '';
    if (listWrap) listWrap.style.display = 'none';
    if (hostWrap) hostWrap.style.display = '';
    try { renderMatch3(); } catch (e) { console.error('[RP Calendar] renderMatch3 error:', e); }
}

function showGameInTab(id) {
    if (id === 'match3') { showMatch3InTab(); return; }

    const listWrap = document.getElementById('rpcal-games-list-wrap');
    const hostWrap = document.getElementById('rpcal-games-host-wrap');
    const m3Wrap   = document.getElementById('rpcal-m3-wrap');
    const host     = document.getElementById('rpcal-games-host');
    // Перед открытием — извлекаем предыдущую панель и прячем match3
    ejectGamePanel();
    if (m3Wrap) m3Wrap.style.display = 'none';
    if (host)   host.style.display = '';
    // Вызываем штатный open(), он создаёт/инициализирует панель в document.body
    try {
        if (window.GameCollection && typeof window.GameCollection.open === 'function') {
            window.GameCollection.open(id);
        }
    } catch (e) {
        console.error('[RP Calendar] GameCollection.open error:', e);
    }
    // Затем переносим её в нашу вкладку
    const ok = injectGamePanel(id);
    if (!ok) {
        showShopToast('Не удалось встроить игру в вкладку', false);
        return;
    }
    if (listWrap) listWrap.style.display = 'none';
    if (hostWrap) hostWrap.style.display = '';
}

function renderGamesList() {
    const grid = document.getElementById('rpcal-games-grid');
    if (!grid) return;

    // При возврате во вкладку — показываем список (без активной игры)
    showGamesList();

    // Загружаем коллекцию при первом открытии
    loadGameCollection();

    const gcList = (typeof window !== 'undefined' && window.GameCollection && Array.isArray(window.GameCollection.list))
        ? window.GameCollection.list
        : FALLBACK_GAMES;

    // «Три в ряд» — встроенная игра, ставим её первым пунктом
    const items = [
        { id: 'match3', name: 'Три в ряд', desc: 'Зарабатывайте 💎 алмазы' },
        ...gcList,
    ];

    let html = '';
    for (const g of items) {
        const subtitle = g.desc ? `<span class="rpcal-game-item-sub">${escapeHtml(g.desc)}</span>` : '';
        html += `
            <button class="rpcal-game-item" data-game="${escapeHtml(g.id)}" type="button">
                <span class="rpcal-game-item-icon">${gameIconHTML(g.id)}</span>
                <span class="rpcal-game-item-text">
                    <span class="rpcal-game-item-name">${escapeHtml(g.name || g.id)}</span>
                    ${subtitle}
                </span>
                <i class="rpcal-game-item-arrow fa-solid fa-chevron-right"></i>
            </button>`;
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.rpcal-game-item').forEach(card => {
        card.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = card.getAttribute('data-game');
            if (!id) return;
            // Match-3 не требует загрузки внешней коллекции
            if (id === 'match3') { showGameInTab(id); return; }
            // Гарантируем загрузку
            const ok = await loadGameCollection();
            if (!ok || !window.GameCollection) {
                showShopToast('Не удалось загрузить коллекцию игр', false);
                return;
            }
            showGameInTab(id);
        });
    });

    // Кнопка «Назад к списку» — привязываем один раз
    const backBtn = document.getElementById('rpcal-games-back');
    if (backBtn && !backBtn._rpcalBound) {
        backBtn._rpcalBound = true;
        backBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showGamesList();
        });
    }
}

// ── Инициализация ──
jQuery(async () => {
    console.log(`[RP Calendar] Loading v${VER}...`);
    try {
        loadS();
        ensureRegex();
        createUI();

        if (event_types.CHARACTER_MESSAGE_RENDERED) {
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (idx) => {
                onMessage(idx);
                // Уменьшаем счётчик активных заказов после каждого ответа бота
                tickShopRequests();
                // Если открыта вкладка магазина — обновим её
                if (currentTab === 'shop' || currentTab === 'events') {
                    try { renderShop(); } catch (_) {}
                }
            });
        }
        if (event_types.USER_MESSAGE_RENDERED) {
            eventSource.on(event_types.USER_MESSAGE_RENDERED, onMessage);
        }
        if (event_types.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, () => onChatChanged(false));
        }
        if (event_types.CHAT_COMPLETION_PROMPT_READY) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
        }
        if (event_types.MESSAGE_SWIPED) {
            eventSource.on(event_types.MESSAGE_SWIPED, () => { LS = agg(); renderWidget(); });
        }
        if (event_types.MESSAGE_DELETED) {
            eventSource.on(event_types.MESSAGE_DELETED, () => { LS = agg(); renderWidget(); });
        }
        if (event_types.MESSAGE_EDITED) {
            eventSource.on(event_types.MESSAGE_EDITED, (idx) => onMessage(idx));
        }

        onChatChanged(false);
        console.log(`[RP Calendar] v${VER} loaded ✓`);
    } catch (err) {
        console.error('[RP Calendar] Init failed:', err);
    }
});