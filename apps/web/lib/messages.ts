/**
 * The public site's single user-facing strings file - same structure as the
 * dashboard's. Uzbek (Latin) is the primary locale and is written in full, as
 * is Russian; English is the fallback base.
 *
 * COPY RULES (§0.2): claim language is banned in every locale - see the term
 * list in scripts/lint-copy.mjs, which fails the build on a match. Verdicts
 * are signals, not promises, and nothing here may claim anything about a
 * person or a phone's owner.
 */

const en = {
  'site.name': 'TozaList',
  'site.tagline': 'Email list hygiene for Uzbekistan',

  'nav.how': 'How it works',
  'nav.pricing': 'Pricing',
  'nav.faq': 'FAQ',
  'nav.pilot': 'Request a pilot',

  'hero.title': 'Clean the email lists your business already owns',
  'hero.subtitle':
    'For agencies, exporters, local SaaS teams and e-commerce stores: find dead, risky and mistyped addresses in the lists your customers gave you — before they hurt your sending.',
  'hero.cta.primary': 'Request a pilot',
  'hero.cta.secondary': 'See how it works',

  'problem.title': 'What a dirty list quietly costs you',
  'problem.1.title': 'Bounced campaigns',
  'problem.1.text':
    'Mail providers watch your bounce rate. A few hundred dead addresses can push whole campaigns into spam for everyone else.',
  'problem.2.title': 'Failed onboarding',
  'problem.2.text':
    'A typo at signup means the confirmation never arrives. The customer thinks you never wrote back.',
  'problem.3.title': 'Wasted spend',
  'problem.3.text':
    'Every message to a dead address is money spent on nobody — and it skews every open-rate number you report.',

  'how.title': 'How it works',
  'how.1': 'Upload a CSV or call the API',
  'how.2': 'We check the format, the domain, its mail records, and disposable or role patterns',
  'how.3': 'Every address comes back with a verdict and the reason for it',
  'how.4': 'You delete or keep — with confidence about why',
  'how.sample.title': 'A sample result',
  'how.badge.valid': 'valid',
  'how.badge.risky': 'risky',
  'how.badge.unknown': 'unknown',
  'how.badge.invalid': 'invalid',
  'how.sample.valid': 'the checks passed',
  'how.sample.risky': 'works, but shared or temporary',
  'how.sample.unknown': 'keep this, we could not determine it',
  'how.sample.invalid': 'the domain accepts no mail',
  'how.unknown.note':
    '"Unknown" is an honest answer, not a failure: some mail servers simply refuse to say. We never tell you to delete an address we could not determine.',

  'notdo.title': 'What we do NOT do',
  'notdo.intro': 'This is the deal, and it is why our customers trust us:',
  'notdo.1': 'We do not sell contact data. Ever. To anyone.',
  'notdo.2': 'We do not look up who owns a phone number, or which carrier it belongs to.',
  'notdo.3': 'We do not scrape websites or social networks.',
  'notdo.4': 'We do not provide data about people you do not already have a relationship with.',
  'notdo.5':
    'We do not promise delivery. Nobody honestly can — we show you risk signals and the reasons behind them.',

  'pricing.title': 'Pilot pricing',
  'pricing.note': 'Pricing is being finalized together with our first partners.',
  'pricing.pilot.name': 'Pilot',
  'pricing.team.name': 'Team',
  'pricing.api.name': 'API',
  'pricing.currency': 'UZS',
  'pricing.thousands': ',',
  'pricing.volumeUnit': 'checks',
  'pricing.cta': 'Request pilot',

  'data.title': 'Your data stays yours',
  'data.1': 'Your lists are used for your checks and for nothing else.',
  'data.2': 'You choose how long results are kept: 7, 30 or 90 days.',
  'data.3': 'You can delete everything at any time.',
  'data.4': 'We never sell, share, or reuse your lists.',

  'form.title': 'Request a pilot',
  'form.email': 'Work email',
  'form.company': 'Company',
  'form.phone': 'Phone (optional)',
  'form.volume': 'Monthly email volume',
  'form.volume.placeholder': 'Choose a range',
  'form.message': 'Anything we should know?',
  'form.submit': 'Send request',
  'form.sending': 'Sending…',
  'form.success.title': 'Thank you!',
  'form.success.text': 'We received your request and will reply within two business days.',
  'form.error': 'Something went wrong. Please try again in a minute.',
  'form.email.invalid': 'Enter a valid email address.',

  'faq.title': 'Frequently asked questions',
  'faq.1.q': 'What happens to my data?',
  'faq.1.a':
    'Your lists are processed only to produce your results, kept for the retention period you choose (7, 30 or 90 days), and can be deleted by you at any time.',
  'faq.2.q': 'Do you promise that my emails will arrive?',
  'faq.2.a':
    'No — and nobody honestly can. Delivery depends on the receiving server at the moment of sending. What we give you are risk signals with reasons, so you can decide what to send and to whom.',
  'faq.3.q': 'What does "unknown" mean?',
  'faq.3.a':
    'It means the mail server would not tell us enough to decide. Keep those addresses — deleting an "unknown" throws away real subscribers.',
  'faq.4.q': 'Do you have an API?',
  'faq.4.a':
    'Yes. Single checks, batch uploads and webhooks, with documentation and code samples. The API tier is built for it.',
  'faq.5.q': 'Can I use TozaList on a purchased list?',
  'faq.5.a':
    'No. We only check lists you collected yourself, from people who gave you their address. Purchased or scraped lists are against our terms — cleaning them does not make them consented.',
  'faq.6.q': 'Which languages do you support?',
  'faq.6.a': 'The product and support are available in Uzbek, Russian and English.',
  'faq.7.q': 'How do I pay?',
  'faq.7.a':
    'During the pilot: by invoice, in UZS, by bank transfer. Card payments are planned together with our payment partner.',
  'faq.8.q': 'What if the results are wrong?',
  'faq.8.a':
    'Tell us. Every verdict carries its reasons, so we can trace exactly why an address was classified — and if we got it wrong, we fix it and credit the checks back.',

  'contact.title': 'Contact us',
  'contact.intro':
    'Questions about pilots, pricing, or the API? Send us a note — we reply within two business days.',
  'footer.privacy': 'Privacy',
  'footer.terms': 'Terms',
  'footer.docs': 'API docs',
  'footer.contact': 'Contact',
  'footer.note': 'Made in Tashkent. Your lists stay yours.',
} as const

export type MessageKey = keyof typeof en

const uz: Record<MessageKey, string> = {
  'site.name': 'TozaList',
  'site.tagline': "O'zbekiston uchun email ro'yxat gigiyenasi",

  'nav.how': 'Qanday ishlaydi',
  'nav.pricing': 'Narxlar',
  'nav.faq': 'Savol-javob',
  'nav.pilot': "Pilotga so'rov yuborish",

  'hero.title': "Biznesingizdagi mavjud email ro'yxatlarini tozalang",
  'hero.subtitle':
    "Agentliklar, eksportchilar, mahalliy SaaS jamoalari va internet-do'konlar uchun: mijozlaringiz o'zi qoldirgan ro'yxatlardagi o'lik, xavfli va xato yozilgan manzillarni ular jo'natmalaringizga zarar yetkazishidan oldin toping.",
  'hero.cta.primary': "Pilotga so'rov yuborish",
  'hero.cta.secondary': "Qanday ishlashini ko'ring",

  'problem.title': "Iflos ro'yxat sizga qanchaga tushadi",
  'problem.1.title': 'Qaytgan xatlar',
  'problem.1.text':
    "Pochta provayderlari qaytish darajangizni kuzatib boradi. Bir necha yuz o'lik manzil butun kampaniyangizni boshqalar uchun ham spamga tushirib yuborishi mumkin.",
  'problem.2.title': "Ro'yxatdan o'tishdagi uzilishlar",
  'problem.2.text':
    "Ro'yxatdan o'tishda yo'l qo'yilgan xato — tasdiqlash xati hech qachon yetib bormaydi. Mijoz esa siz javob bermadingiz deb o'ylaydi.",
  'problem.3.title': 'Behuda xarajat',
  'problem.3.text':
    "O'lik manzilga yuborilgan har bir xabar — hech kimga sarflangan pul. Bundan tashqari, u hisobotlaringizdagi barcha ko'rsatkichlarni buzadi.",

  'how.title': 'Qanday ishlaydi',
  'how.1': 'CSV yuklang yoki API orqali murojaat qiling',
  'how.2':
    'Biz format, domen, pochta yozuvlari hamda vaqtinchalik va umumiy (role) manzil belgilarini tekshiramiz',
  'how.3': 'Har bir manzil hukm va uning sababi bilan qaytadi',
  'how.4': "Siz esa nima uchunligini bilgan holda o'chirasiz yoki saqlab qolasiz",
  'how.sample.title': 'Natija namunasi',
  'how.badge.valid': 'yaroqli',
  'how.badge.risky': 'xavfli',
  'how.badge.unknown': "noma'lum",
  'how.badge.invalid': 'yaroqsiz',
  'how.sample.valid': "tekshiruvlardan o'tdi",
  'how.sample.risky': 'ishlaydi, lekin umumiy yoki vaqtinchalik',
  'how.sample.unknown': 'saqlab qoling, aniqlay olmadik',
  'how.sample.invalid': 'domen pochta qabul qilmaydi',
  'how.unknown.note':
    "“Unknown” — bu halol javob, xatolik emas: ayrim pochta serverlari shunchaki ma'lumot bermaydi. Aniqlay olmagan manzilimizni o'chirishni hech qachon maslahat bermaymiz.",

  'notdo.title': 'Biz nima QILMAYMIZ',
  'notdo.intro': 'Kelishuvimiz shu — va mijozlarimiz bizga aynan shuning uchun ishonadi:',
  'notdo.1': "Kontakt ma'lumotlarini sotmaymiz. Hech qachon. Hech kimga.",
  'notdo.2':
    'Telefon raqami kimga tegishli ekanini yoki qaysi operatorga qarashligini aniqlamaymiz.',
  'notdo.3': "Saytlar va ijtimoiy tarmoqlardan ma'lumot yig'maymiz.",
  'notdo.4': "Siz bilan aloqasi bo'lmagan odamlar haqida ma'lumot bermaymiz.",
  'notdo.5':
    "Xat yetib borishini va'da qilmaymiz. Buni halol tarzda hech kim qila olmaydi — biz xavf belgilari va ularning sabablarini ko'rsatamiz.",

  'pricing.title': 'Pilot narxlari',
  'pricing.note': 'Narxlar ilk hamkorlarimiz bilan birgalikda yakunlanmoqda.',
  'pricing.pilot.name': 'Pilot',
  'pricing.team.name': 'Team',
  'pricing.api.name': 'API',
  'pricing.currency': "so'm",
  'pricing.thousands': ' ',
  'pricing.volumeUnit': 'tekshiruv',
  'pricing.cta': "Pilotga so'rov",

  'data.title': "Ma'lumotlaringiz o'zingizniki bo'lib qoladi",
  'data.1':
    "Ro'yxatlaringiz faqat sizning tekshiruvlaringiz uchun ishlatiladi, boshqa hech narsa uchun emas.",
  'data.2': 'Natijalar qancha saqlanishini o‘zingiz tanlaysiz: 7, 30 yoki 90 kun.',
  'data.3': "Istalgan vaqtda hammasini o'chirib tashlashingiz mumkin.",
  'data.4': "Ro'yxatlaringizni hech qachon sotmaymiz, ulashmaymiz va qayta ishlatmaymiz.",

  'form.title': "Pilotga so'rov yuborish",
  'form.email': 'Ish email manzili',
  'form.company': 'Kompaniya',
  'form.phone': 'Telefon (ixtiyoriy)',
  'form.volume': 'Oylik email hajmi',
  'form.volume.placeholder': 'Oraliqni tanlang',
  'form.message': "Bilishimiz kerak bo'lgan narsa bormi?",
  'form.submit': "So'rov yuborish",
  'form.sending': 'Yuborilmoqda…',
  'form.success.title': 'Rahmat!',
  'form.success.text': "So'rovingizni oldik va ikki ish kuni ichida javob beramiz.",
  'form.error': "Xatolik yuz berdi. Bir daqiqadan so'ng qayta urinib ko'ring.",
  'form.email.invalid': "To'g'ri email manzil kiriting.",

  'faq.title': "Ko'p beriladigan savollar",
  'faq.1.q': "Ma'lumotlarim bilan nima bo'ladi?",
  'faq.1.a':
    "Ro'yxatlaringiz faqat natijalaringizni tayyorlash uchun qayta ishlanadi, siz tanlagan muddat (7, 30 yoki 90 kun) saqlanadi va istalgan vaqtda o'zingiz o'chira olasiz.",
  'faq.2.q': "Xatlarim yetib borishiga va'da berasizmi?",
  'faq.2.a':
    "Yo'q — buni halol tarzda hech kim qila olmaydi. Yetib borish jo'natish paytidagi qabul qiluvchi serverga bog'liq. Biz esa sizga sabablari bilan xavf belgilarini beramiz — nimani va kimga yuborishni o'zingiz hal qilasiz.",
  'faq.3.q': '"Unknown" nimani anglatadi?',
  'faq.3.a':
    "Pochta serveri qaror qabul qilish uchun yetarli ma'lumot bermaganini anglatadi. Bunday manzillarni saqlab qoling — \"unknown\"ni o'chirish haqiqiy obunachilarni yo'qotish demakdir.",
  'faq.4.q': 'API bormi?',
  'faq.4.a':
    "Ha. Yakka tekshiruvlar, ommaviy yuklash va webhooklar — hujjatlar va kod namunalari bilan. API tarifi aynan shu uchun mo'ljallangan.",
  'faq.5.q': "Sotib olingan ro'yxatda ishlatsam bo'ladimi?",
  'faq.5.a':
    "Yo'q. Biz faqat o'zingiz to'plagan, egalari manzilini sizga o'zi qoldirgan ro'yxatlarni tekshiramiz. Sotib olingan yoki yig'ib olingan ro'yxatlar shartlarimizga zid — ularni tozalash rozilik o'rnini bosmaydi.",
  'faq.6.q': "Qaysi tillarni qo'llab-quvvatlaysiz?",
  'faq.6.a': "Mahsulot va yordam o'zbek, rus va ingliz tillarida mavjud.",
  'faq.7.q': "To'lovni qanday amalga oshiraman?",
  'faq.7.a':
    "Pilot davrida: hisob-faktura orqali, so'mda, bank o'tkazmasi bilan. Karta orqali to'lov to'lov hamkorimiz bilan birga rejalashtirilgan.",
  'faq.8.q': "Natijalar noto'g'ri chiqsa-chi?",
  'faq.8.a':
    "Bizga ayting. Har bir hukm o'z sabablari bilan keladi, shuning uchun manzil nega bunday baholanganini aniq ko'rsatib bera olamiz — xato bizdan bo'lsa, tuzatamiz va tekshiruvlarni hisobingizga qaytaramiz.",

  'contact.title': 'Biz bilan aloqa',
  'contact.intro':
    'Pilot, narxlar yoki API haqida savolingiz bormi? Bizga yozing — ikki ish kuni ichida javob beramiz.',
  'footer.privacy': 'Maxfiylik',
  'footer.terms': 'Shartlar',
  'footer.docs': 'API hujjatlari',
  'footer.contact': 'Aloqa',
  'footer.note': "Toshkentda yaratilgan. Ro'yxatlaringiz o'zingizniki bo'lib qoladi.",
}

const ru: Record<MessageKey, string> = {
  'site.name': 'TozaList',
  'site.tagline': 'Гигиена email-списков для Узбекистана',

  'nav.how': 'Как это работает',
  'nav.pricing': 'Цены',
  'nav.faq': 'Вопросы',
  'nav.pilot': 'Запросить пилот',

  'hero.title': 'Очистите email-списки, которые уже есть у вашего бизнеса',
  'hero.subtitle':
    'Для агентств, экспортёров, локальных SaaS-команд и интернет-магазинов: найдите мёртвые, рискованные и опечатанные адреса в списках, которые вам оставили сами клиенты, — прежде чем они навредят вашим рассылкам.',
  'hero.cta.primary': 'Запросить пилот',
  'hero.cta.secondary': 'Посмотреть, как это работает',

  'problem.title': 'Во что вам тихо обходится грязный список',
  'problem.1.title': 'Возвраты рассылок',
  'problem.1.text':
    'Почтовые провайдеры следят за долей возвратов. Несколько сотен мёртвых адресов могут отправить всю кампанию в спам и для остальных.',
  'problem.2.title': 'Сорванный онбординг',
  'problem.2.text':
    'Опечатка при регистрации — и письмо с подтверждением не приходит никогда. Клиент уверен, что вы ему не ответили.',
  'problem.3.title': 'Потраченный впустую бюджет',
  'problem.3.text':
    'Каждое письмо на мёртвый адрес — деньги, потраченные впустую. К тому же оно искажает все показатели, которые вы отчитываете.',

  'how.title': 'Как это работает',
  'how.1': 'Загрузите CSV или обратитесь к API',
  'how.2':
    'Мы проверяем формат, домен, его почтовые записи, а также признаки временных и общих (role) адресов',
  'how.3': 'Каждый адрес возвращается с вердиктом и его причиной',
  'how.4': 'Вы удаляете или оставляете — понимая, почему',
  'how.sample.title': 'Пример результата',
  'how.badge.valid': 'рабочий',
  'how.badge.risky': 'рискованный',
  'how.badge.unknown': 'неизвестно',
  'how.badge.invalid': 'нерабочий',
  'how.sample.valid': 'проверки пройдены',
  'how.sample.risky': 'работает, но общий или временный',
  'how.sample.unknown': 'оставьте, мы не смогли определить',
  'how.sample.invalid': 'домен не принимает почту',
  'how.unknown.note':
    '«Unknown» — честный ответ, а не ошибка: некоторые почтовые серверы просто не отвечают. Мы никогда не советуем удалять адрес, который не смогли определить.',

  'notdo.title': 'Чего мы НЕ делаем',
  'notdo.intro': 'Это наш принцип — и именно поэтому нам доверяют:',
  'notdo.1': 'Мы не продаём контактные данные. Никогда. Никому.',
  'notdo.2': 'Мы не выясняем, кому принадлежит номер телефона и у какого он оператора.',
  'notdo.3': 'Мы не собираем данные с сайтов и социальных сетей.',
  'notdo.4': 'Мы не предоставляем данные о людях, с которыми у вас нет отношений.',
  'notdo.5':
    'Мы не обещаем доставку. Честно этого не может никто — мы показываем сигналы риска и их причины.',

  'pricing.title': 'Пилотные цены',
  'pricing.note': 'Цены дорабатываются вместе с нашими первыми партнёрами.',
  'pricing.pilot.name': 'Pilot',
  'pricing.team.name': 'Team',
  'pricing.api.name': 'API',
  'pricing.currency': 'сум',
  'pricing.thousands': ' ',
  'pricing.volumeUnit': 'проверок',
  'pricing.cta': 'Запросить пилот',

  'data.title': 'Ваши данные остаются вашими',
  'data.1': 'Ваши списки используются только для ваших проверок — и ни для чего больше.',
  'data.2': 'Срок хранения результатов выбираете вы: 7, 30 или 90 дней.',
  'data.3': 'Вы можете удалить всё в любой момент.',
  'data.4': 'Мы никогда не продаём, не передаём и не переиспользуем ваши списки.',

  'form.title': 'Запросить пилот',
  'form.email': 'Рабочий email',
  'form.company': 'Компания',
  'form.phone': 'Телефон (необязательно)',
  'form.volume': 'Объём писем в месяц',
  'form.volume.placeholder': 'Выберите диапазон',
  'form.message': 'Что нам стоит знать?',
  'form.submit': 'Отправить запрос',
  'form.sending': 'Отправляем…',
  'form.success.title': 'Спасибо!',
  'form.success.text': 'Мы получили ваш запрос и ответим в течение двух рабочих дней.',
  'form.error': 'Что-то пошло не так. Попробуйте ещё раз через минуту.',
  'form.email.invalid': 'Введите корректный email-адрес.',

  'faq.title': 'Частые вопросы',
  'faq.1.q': 'Что происходит с моими данными?',
  'faq.1.a':
    'Ваши списки обрабатываются только для получения ваших результатов, хранятся выбранный вами срок (7, 30 или 90 дней) и могут быть удалены вами в любой момент.',
  'faq.2.q': 'Вы обещаете, что мои письма дойдут?',
  'faq.2.a':
    'Нет — и честно этого не может никто. Доставка зависит от принимающего сервера в момент отправки. Мы даём сигналы риска с причинами, а решение — что и кому отправлять — остаётся за вами.',
  'faq.3.q': 'Что означает «unknown»?',
  'faq.3.a':
    'Почтовый сервер не дал достаточно информации для решения. Оставьте такие адреса — удаляя «unknown», вы выбрасываете настоящих подписчиков.',
  'faq.4.q': 'У вас есть API?',
  'faq.4.a':
    'Да. Одиночные проверки, массовая загрузка и вебхуки — с документацией и примерами кода. Тариф API создан именно для этого.',
  'faq.5.q': 'Можно проверить купленный список?',
  'faq.5.a':
    'Нет. Мы проверяем только списки, собранные вами, где люди сами оставили вам адрес. Купленные и собранные из открытых источников списки противоречат нашим условиям — их очистка не заменяет согласие.',
  'faq.6.q': 'Какие языки вы поддерживаете?',
  'faq.6.a': 'Продукт и поддержка доступны на узбекском, русском и английском.',
  'faq.7.q': 'Как оплатить?',
  'faq.7.a':
    'В период пилота — по счёту, в сумах, банковским переводом. Оплата картой планируется вместе с платёжным партнёром.',
  'faq.8.q': 'А если результаты неверные?',
  'faq.8.a':
    'Скажите нам. Каждый вердикт приходит со своими причинами, поэтому мы можем точно объяснить, почему адрес получил такую оценку, — а если ошиблись мы, исправим и вернём проверки на счёт.',

  'contact.title': 'Свяжитесь с нами',
  'contact.intro':
    'Вопросы о пилоте, ценах или API? Напишите нам — ответим в течение двух рабочих дней.',
  'footer.privacy': 'Конфиденциальность',
  'footer.terms': 'Условия',
  'footer.docs': 'Документация API',
  'footer.contact': 'Контакты',
  'footer.note': 'Сделано в Ташкенте. Ваши списки остаются вашими.',
}

const locales = { en, uz, ru } as const
export type Locale = keyof typeof locales

export const LOCALES: Locale[] = ['uz', 'ru', 'en']
export const DEFAULT_LOCALE: Locale = 'uz'

export function isLocale(value: string): value is Locale {
  return (LOCALES as string[]).includes(value)
}

/** Translates a key in the given locale, falling back to English. */
export function t(locale: Locale, key: MessageKey): string {
  const table = locales[locale] as Partial<Record<MessageKey, string>>
  return table[key] ?? en[key]
}

export const MESSAGES_BY_LOCALE = locales
