// Help & FAQ (owner 2026-10-29): every question and answer for help.html, in English, Spanish and Arabic. The English was
// approved by the owner in the shared draft doc; the translations ship as written (owner's choice). Button names stay
// in English in every language so they match the screens.
//
// Each item: id, who, q and a ({ en, es, ar }), and optionally backend and go.
//   who: 'everyone' | 'employee' | 'owner' | a permission key (PERMISSIONS in Permissions.js). An employee sees an item
//        tagged 'everyone' or 'employee' or one of the permissions the owner turned on for them; the owner sees all.
//   backend: 'sheets' | 'supabase' — only on that backend (sign-in, passwords and months work differently).
//   go: the page the Go There button opens.
// Answers: one paragraph per line; lines starting "1. " make a numbered list, lines starting "- " a bullet list.
// Rules (test/browser/help.js): no dollar sign in anything an employee can see (except the password rule's signs),
// no game names or the state lottery's name, every go page exists.

const HELP_LANGS = [
  { id: 'en', name: 'English', dir: 'ltr' },
  { id: 'es', name: 'Español', dir: 'ltr' },
  { id: 'ar', name: 'العربية', dir: 'rtl' },
];

// The Help page's own words.
const HELP_WORDS = {
  intro: {
    en: 'Answers to common questions. Tap a question to open it.',
    es: 'Respuestas a preguntas comunes. Toca una pregunta para abrirla.',
    ar: 'إجابات عن الأسئلة الشائعة. اضغط على سؤال لفتحه.',
  },
  search: { en: 'Search questions', es: 'Buscar preguntas', ar: 'ابحث في الأسئلة' },
  noMatch: {
    en: 'No questions match. Try other words.',
    es: 'Ninguna pregunta coincide. Prueba con otras palabras.',
    ar: 'لا توجد أسئلة مطابقة. جرّب كلمات أخرى.',
  },
  goThere: { en: 'Go There', es: 'Ir allí', ar: 'اذهب إليها' },
};

const FAQ = [
  {
    id: 'start',
    title: { en: 'Getting Started', es: 'Primeros pasos', ar: 'البداية' },
    items: [
      {
        id: 'sign-in', who: 'everyone', backend: 'supabase',
        q: { en: 'How do I sign in?', es: '¿Cómo inicio sesión?', ar: 'كيف أسجّل الدخول؟' },
        a: {
          en: 'Type your email and password on Sign In. The owner adds you first, and you get an email to choose your password.',
          es: 'Escribe tu correo y tu contraseña en Sign In. Primero el dueño te agrega y recibes un correo para elegir tu contraseña.',
          ar: 'اكتب بريدك الإلكتروني وكلمة المرور في صفحة Sign In. يضيفك المالك أولاً، ثم تصلك رسالة لاختيار كلمة المرور.',
        },
      },
      {
        id: 'sign-in', who: 'everyone', backend: 'sheets',
        q: { en: 'How do I sign in?', es: '¿Cómo inicio sesión?', ar: 'كيف أسجّل الدخول؟' },
        a: {
          en: 'Type your username and password on Sign In. The owner adds you and tells you your first password.',
          es: 'Escribe tu nombre de usuario y tu contraseña en Sign In. El dueño te agrega y te dice tu primera contraseña.',
          ar: 'اكتب اسم المستخدم وكلمة المرور في صفحة Sign In. يضيفك المالك ويخبرك بكلمة المرور الأولى.',
        },
      },
      {
        id: 'invite', who: 'everyone', backend: 'supabase',
        q: { en: 'I never got my invite email.', es: 'No me llegó el correo de invitación.', ar: 'لم تصلني رسالة الدعوة.' },
        a: {
          en: 'Look in your Spam or Junk folder for "Your Smart Scan Account". The link works once, for 24 hours. If it\'s gone or expired, ask the owner to tap Resend Invite, or to set a password for you.',
          es: 'Busca "Your Smart Scan Account" en tu carpeta de Spam o Correo no deseado. El enlace funciona una sola vez, durante 24 horas. Si no lo encuentras o ya venció, pide al dueño que toque Resend Invite o que te ponga una contraseña.',
          ar: 'ابحث عن رسالة "Your Smart Scan Account" في مجلد البريد العشوائي (Spam). يعمل الرابط مرة واحدة فقط لمدة 24 ساعة. إذا لم تجدها أو انتهت صلاحيتها، اطلب من المالك الضغط على Resend Invite أو تعيين كلمة مرور لك.',
        },
      },
      {
        id: 'forgot', who: 'everyone', backend: 'supabase',
        q: { en: 'I forgot my password.', es: 'Olvidé mi contraseña.', ar: 'نسيت كلمة المرور.' },
        a: {
          en: 'Type your email on Sign In, then tap Forgot Password?. You\'ll get an email to choose a new one (check Spam). The link works once, for 24 hours.',
          es: 'Escribe tu correo en Sign In y toca Forgot Password?. Recibirás un correo para elegir una nueva (revisa Spam). El enlace funciona una sola vez, durante 24 horas.',
          ar: 'اكتب بريدك الإلكتروني في صفحة Sign In ثم اضغط Forgot Password?. ستصلك رسالة لاختيار كلمة مرور جديدة (تحقّق من Spam). يعمل الرابط مرة واحدة فقط لمدة 24 ساعة.',
        },
      },
      {
        id: 'forgot', who: 'everyone', backend: 'sheets',
        q: { en: 'I forgot my password.', es: 'Olvidé mi contraseña.', ar: 'نسيت كلمة المرور.' },
        a: {
          en: 'Ask the owner to tap Reset Password on your card in Manage Employees and tell you the new one.',
          es: 'Pide al dueño que toque Reset Password en tu tarjeta de Manage Employees y te diga la nueva.',
          ar: 'اطلب من المالك الضغط على Reset Password في بطاقتك في Manage Employees وإخبارك بكلمة المرور الجديدة.',
        },
      },
      {
        id: 'password-rule', who: 'everyone',
        q: { en: 'What can my password be?', es: '¿Cómo debe ser mi contraseña?', ar: 'ما شروط كلمة المرور؟' },
        a: {
          en: 'At least 8 characters, with a capital letter, a lowercase letter, a number and one of ? ! @ # $ % &. It can\'t be the same as your last password.',
          es: 'Al menos 8 caracteres, con una mayúscula, una minúscula, un número y uno de ? ! @ # $ % &. No puede ser igual a tu contraseña anterior.',
          ar: '8 أحرف على الأقل، وفيها حرف كبير وحرف صغير ورقم وواحد من ? ! @ # $ % &. ولا يمكن أن تكون مثل كلمة المرور السابقة.',
        },
      },
      {
        id: 'change-password', who: 'everyone', go: 'account.html',
        q: { en: 'How do I change my password?', es: '¿Cómo cambio mi contraseña?', ar: 'كيف أغيّر كلمة المرور؟' },
        a: {
          en: 'More → Change My Password. Type your current password, then the new one twice.',
          es: 'More → Change My Password. Escribe tu contraseña actual y luego la nueva dos veces.',
          ar: 'More ← Change My Password. اكتب كلمة المرور الحالية، ثم الجديدة مرتين.',
        },
      },
      {
        id: 'home-screen', who: 'everyone',
        q: { en: 'How do I put Smart Scan on my home screen?', es: '¿Cómo pongo Smart Scan en mi pantalla de inicio?', ar: 'كيف أضع Smart Scan على الشاشة الرئيسية؟' },
        a: {
          en: 'On iPhone, open Smart Scan in Safari, tap Share, then Add to Home Screen. It then opens like an app, full screen.',
          es: 'En iPhone, abre Smart Scan en Safari, toca Compartir y luego Agregar a inicio. Después se abre como una app, en pantalla completa.',
          ar: 'على iPhone، افتح Smart Scan في Safari، واضغط مشاركة ثم إضافة إلى الشاشة الرئيسية. بعدها يفتح كتطبيق بملء الشاشة.',
        },
      },
      {
        id: 'sign-in-again', who: 'everyone',
        q: {
          en: 'I signed in, but the home-screen app asks me to sign in again.',
          es: 'Ya inicié sesión, pero la app de la pantalla de inicio me lo pide otra vez.',
          ar: 'سجّلت الدخول، لكن التطبيق على الشاشة الرئيسية يطلب تسجيل الدخول مرة أخرى.',
        },
        a: {
          en: 'On iPhone the home-screen app keeps its own sign-in, separate from Safari. Sign in once more inside the app.',
          es: 'En iPhone, la app de la pantalla de inicio guarda su propia sesión, aparte de Safari. Inicia sesión una vez más dentro de la app.',
          ar: 'على iPhone يحتفظ التطبيق على الشاشة الرئيسية بتسجيل دخول خاص به، منفصل عن Safari. سجّل الدخول مرة أخرى داخل التطبيق.',
        },
      },
      {
        id: 'signed-out', who: 'everyone',
        q: { en: 'Why was I signed out?', es: '¿Por qué se cerró mi sesión?', ar: 'لماذا تم تسجيل خروجي؟' },
        a: {
          en: 'You stay signed in for 12 hours, then sign in again. You\'re also signed out if the owner turns your account off.',
          es: 'La sesión dura 12 horas; después vuelves a iniciar sesión. También se cierra si el dueño desactiva tu cuenta.',
          ar: 'يبقى تسجيل الدخول 12 ساعة، ثم تسجّل الدخول من جديد. ويتم تسجيل خروجك أيضاً إذا أوقف المالك حسابك.',
        },
      },
    ],
  },
  {
    id: 'close',
    title: { en: 'Close Day', es: 'Cierre del día (Close Day)', ar: 'إغلاق اليوم (Close Day)' },
    items: [
      {
        id: 'how-close', who: 'everyone', go: 'close.html',
        q: { en: 'How do I close the day?', es: '¿Cómo cierro el día?', ar: 'كيف أغلق اليوم؟' },
        a: {
          en: '1. On Home, tap Close Day (employees: Scan Tickets).\n'
            + '1. For each slot, scan the top ticket: the next one that would sell. The app finds the slot by itself, so any order works.\n'
            + '1. If a pack ran out, tap Sold Out on its card instead of scanning.\n'
            + '1. When every slot is done, tap Submit. The day\'s sales are counted from last night\'s close.',
          es: '1. En Home, toca Close Day (empleados: Scan Tickets).\n'
            + '1. En cada casilla, escanea el boleto de arriba: el siguiente que se vendería. La app encuentra la casilla sola, así que el orden no importa.\n'
            + '1. Si un paquete se terminó, toca Sold Out en su tarjeta en vez de escanear.\n'
            + '1. Cuando termines todas las casillas, toca Submit. Las ventas del día se cuentan desde el cierre de anoche.',
          ar: '1. في Home، اضغط Close Day (للموظفين: Scan Tickets).\n'
            + '1. في كل خانة، امسح التذكرة العلوية: التذكرة التالية التي ستُباع. التطبيق يجد الخانة بنفسه، فالترتيب لا يهم.\n'
            + '1. إذا نفدت رزمة، اضغط Sold Out على بطاقتها بدلاً من المسح.\n'
            + '1. عند الانتهاء من كل الخانات، اضغط Submit. تُحسب مبيعات اليوم من إغلاق الليلة الماضية.',
        },
      },
      {
        id: 'scan', who: 'everyone',
        q: { en: 'How do I scan a ticket?', es: '¿Cómo escaneo un boleto?', ar: 'كيف أمسح تذكرة؟' },
        a: {
          en: 'Point the camera at the barcode on the back of the ticket, then press and hold the Press and Hold button until it reads. If the barcode won\'t read, type the number printed on the ticket instead.',
          es: 'Apunta la cámara al código de barras en la parte de atrás del boleto y mantén presionado el botón Press and Hold hasta que lo lea. Si no lo lee, escribe el número impreso en el boleto.',
          ar: 'وجّه الكاميرا إلى الباركود على ظهر التذكرة، ثم اضغط مطولاً على زر Press and Hold حتى تتم القراءة. إذا لم يُقرأ الباركود، اكتب الرقم المطبوع على التذكرة.',
        },
      },
      {
        id: 'auto-scan', who: 'everyone',
        q: { en: 'What\'s Auto Scan?', es: '¿Qué es Auto Scan?', ar: 'ما هو Auto Scan؟' },
        a: {
          en: 'With Auto Scan on, the camera reads barcodes by itself without holding the button. The phone remembers your choice for Close Day.',
          es: 'Con Auto Scan activado, la cámara lee los códigos sola, sin mantener el botón. El teléfono recuerda tu elección para Close Day.',
          ar: 'عند تشغيل Auto Scan تقرأ الكاميرا الباركود بنفسها دون الضغط على الزر. ويتذكّر الهاتف اختيارك في Close Day.',
        },
      },
      {
        id: 'beeps', who: 'everyone',
        q: { en: 'What do the buzz and beeps mean?', es: '¿Qué significan la vibración y los pitidos?', ar: 'ماذا تعني الاهتزازة والصفارات؟' },
        a: {
          en: 'One high beep: the scan was saved. Two low beeps: it wasn\'t, and the message on the camera picture says why. With Press and Hold, the phone also buzzes when you lift your finger.',
          es: 'Un pitido agudo: el escaneo se guardó. Dos pitidos graves: no se guardó, y el mensaje sobre la imagen de la cámara dice por qué. Con Press and Hold, el teléfono también vibra al levantar el dedo.',
          ar: 'صفارة واحدة عالية: تم حفظ المسح. صفارتان منخفضتان: لم يُحفظ، والرسالة على صورة الكاميرا توضّح السبب. مع Press and Hold يهتز الهاتف أيضاً عند رفع إصبعك.',
        },
      },
      {
        id: 'unchanged', who: 'everyone',
        q: { en: 'The ticket didn\'t change since last night.', es: 'El boleto no cambió desde anoche.', ar: 'التذكرة لم تتغيّر منذ الليلة الماضية.' },
        a: {
          en: 'Scan it anyway. The same ticket as last night means 0 sold for that pack, and every slot with a pack must be scanned.',
          es: 'Escanéalo de todos modos. El mismo boleto que anoche significa 0 vendidos en ese paquete, y hay que escanear cada casilla que tenga paquete.',
          ar: 'امسحها على أي حال. نفس تذكرة الليلة الماضية تعني أنه لم يُبع شيء من تلك الرزمة، ويجب مسح كل خانة فيها رزمة.',
        },
      },
      {
        id: 'skip', who: 'everyone',
        q: { en: 'What does Skip do?', es: '¿Qué hace Skip?', ar: 'ماذا يفعل Skip؟' },
        a: {
          en: 'It moves on to the next slot and leaves this one for later. You can\'t submit until every slot is scanned or marked Sold Out.',
          es: 'Pasa a la siguiente casilla y deja esta para después. No puedes enviar hasta que cada casilla esté escaneada o marcada Sold Out.',
          ar: 'ينتقل إلى الخانة التالية ويترك هذه لوقت لاحق. لا يمكنك الإرسال حتى تُمسح كل خانة أو يُضغط عليها Sold Out.',
        },
      },
      {
        id: 'fix-scans', who: 'everyone',
        q: { en: 'I made a mistake in my scans before submitting.', es: 'Me equivoqué al escanear antes de enviar.', ar: 'أخطأت في المسح قبل الإرسال.' },
        a: {
          en: 'Scan that slot again: the newest scan replaces the old one. To start over, tap Clear All Scans. It only clears this phone\'s scans.',
          es: 'Vuelve a escanear esa casilla: el escaneo nuevo reemplaza al anterior. Para empezar de nuevo, toca Clear All Scans. Solo borra los escaneos de este teléfono.',
          ar: 'امسح تلك الخانة مرة أخرى: المسح الجديد يحل محل القديم. للبدء من جديد اضغط Clear All Scans. يمسح فقط ما على هذا الهاتف.',
        },
      },
      {
        id: 'no-internet', who: 'everyone',
        q: { en: 'I lost internet while submitting.', es: 'Me quedé sin internet al enviar.', ar: 'انقطع الإنترنت أثناء الإرسال.' },
        a: {
          en: 'The close is saved on the phone and says "saved, not sent yet". It sends by itself when the connection is back, so don\'t close again. To fix something first, tap Stop Sending and Change Scans.',
          es: 'El cierre queda guardado en el teléfono y dice "saved, not sent yet". Se envía solo cuando vuelve la conexión, así que no cierres otra vez. Para corregir algo antes, toca Stop Sending and Change Scans.',
          ar: 'يُحفظ الإغلاق على الهاتف وتظهر عبارة "saved, not sent yet". يُرسل وحده عند عودة الاتصال، فلا تُغلق مرة أخرى. لتصحيح شيء أولاً اضغط Stop Sending and Change Scans.',
        },
      },
      {
        id: 'close-yesterday', who: 'everyone', go: 'index.html',
        q: { en: 'Nobody closed last night.', es: 'Nadie cerró anoche.', ar: 'لم يُغلق أحد الليلة الماضية.' },
        a: {
          en: 'Before 12:00 PM, tap Close Yesterday on Home and scan as you would have last night. It isn\'t offered once something changed today (a pack put in or sold out, a full pack sold, a shift close). If you miss it, tonight\'s close counts both days.',
          es: 'Antes de las 12:00 PM, toca Close Yesterday en Home y escanea como lo habrías hecho anoche. No aparece si algo cambió hoy (un paquete puesto o agotado, un paquete completo vendido, un cierre de turno). Si no alcanzas, el cierre de esta noche cuenta los dos días.',
          ar: 'قبل الساعة 12:00 ظهراً، اضغط Close Yesterday في Home وامسح كما كنت ستفعل الليلة الماضية. لا يظهر إذا تغيّر شيء اليوم (رزمة وُضعت أو نفدت، بيع رزمة كاملة، إغلاق وردية). إذا فاتك، فإغلاق الليلة يحسب اليومين معاً.',
        },
      },
      {
        id: 'closed-wrong', who: 'everyone',
        q: { en: 'The day was closed with a mistake.', es: 'El día se cerró con un error.', ar: 'أُغلق اليوم وفيه خطأ.' },
        a: {
          en: 'Tell the owner. The owner opens Close Day and taps Reopen Today\'s Close to Fix It. Every slot goes back to before the close, then the day is closed again.',
          es: 'Avisa al dueño. El dueño abre Close Day y toca Reopen Today\'s Close to Fix It. Cada casilla vuelve a como estaba antes del cierre y luego se cierra el día otra vez.',
          ar: 'أخبر المالك. يفتح المالك Close Day ويضغط Reopen Today\'s Close to Fix It. تعود كل خانة إلى ما قبل الإغلاق، ثم يُغلق اليوم من جديد.',
        },
      },
      {
        id: 'close-twice', who: 'everyone',
        q: { en: 'Can we close twice in one day?', es: '¿Se puede cerrar dos veces en un día?', ar: 'هل يمكن الإغلاق مرتين في اليوم؟' },
        a: {
          en: 'No, one close per day. To change it, the owner reopens it.',
          es: 'No, un cierre por día. Para cambiarlo, el dueño lo reabre.',
          ar: 'لا، إغلاق واحد في اليوم. لتغييره يعيد المالك فتحه.',
        },
      },
    ],
  },
  {
    id: 'shift',
    title: { en: 'Close My Shift', es: 'Cerrar mi turno (Close My Shift)', ar: 'إغلاق ورديتي (Close My Shift)' },
    items: [
      {
        id: 'shift-what', who: 'everyone', go: 'close.html?shift=1',
        q: { en: 'What is Close My Shift for?', es: '¿Para qué sirve Close My Shift?', ar: 'ما فائدة Close My Shift؟' },
        a: {
          en: 'At the end of your shift, scan every slot the same way as Close Day. It shows what sold during your shift, so it can be checked against the register.',
          es: 'Al final de tu turno, escanea cada casilla igual que en Close Day. Muestra lo que se vendió en tu turno, para compararlo con la caja.',
          ar: 'في نهاية ورديتك، امسح كل خانة كما في Close Day. يُظهر ما بِيع خلال ورديتك لمقارنته مع الصندوق.',
        },
      },
      {
        id: 'shift-day', who: 'everyone',
        q: { en: 'Does a shift close change the night\'s Close Day?', es: '¿El cierre de turno cambia el Close Day de la noche?', ar: 'هل يغيّر إغلاق الوردية إغلاق اليوم في الليل؟' },
        a: {
          en: 'No. Close Day still counts the whole day from last night\'s close. Shift closes are only for checking each shift.',
          es: 'No. Close Day sigue contando todo el día desde el cierre de anoche. Los cierres de turno son solo para revisar cada turno.',
          ar: 'لا. يبقى Close Day يحسب اليوم كله من إغلاق الليلة الماضية. إغلاقات الورديات للمراجعة فقط.',
        },
      },
      {
        id: 'shift-twice', who: 'everyone',
        q: { en: 'Can I close my shift twice?', es: '¿Puedo cerrar mi turno dos veces?', ar: 'هل يمكنني إغلاق ورديتي مرتين؟' },
        a: {
          en: 'Employees close one shift a day each. If you made a mistake, ask the owner to delete it, then close it again.',
          es: 'Cada empleado cierra un turno por día. Si te equivocaste, pide al dueño que lo borre y ciérralo otra vez.',
          ar: 'يغلق كل موظف وردية واحدة في اليوم. إذا أخطأت، اطلب من المالك حذفها ثم أغلقها من جديد.',
        },
      },
      {
        id: 'shift-sold-out', who: 'everyone',
        q: { en: 'A pack sold out during my shift.', es: 'Un paquete se agotó en mi turno.', ar: 'نفدت رزمة خلال ورديتي.' },
        a: {
          en: 'Tap Sold Out on its card. It counts every ticket left in your shift, but the pack stays in its slot until it\'s marked Sold Out on Close Day or the slot page.',
          es: 'Toca Sold Out en su tarjeta. Cuenta todos los boletos que quedaban en tu turno, pero el paquete sigue en su casilla hasta que se marque Sold Out en Close Day o en la página de la casilla.',
          ar: 'اضغط Sold Out على بطاقتها. تُحسب كل التذاكر المتبقية في ورديتك، لكن الرزمة تبقى في خانتها حتى يُضغط Sold Out في Close Day أو في صفحة الخانة.',
        },
      },
      {
        id: 'shift-cant', who: 'everyone',
        q: { en: 'Why can\'t I close my shift?', es: '¿Por qué no puedo cerrar mi turno?', ar: 'لماذا لا أستطيع إغلاق ورديتي؟' },
        a: {
          en: 'Shift closes stop once the day is closed. With no internet it says so, and your scans stay on the phone until you can send them.',
          es: 'Los cierres de turno se detienen cuando el día ya está cerrado. Sin internet te lo avisa, y tus escaneos quedan en el teléfono hasta que puedas enviarlos.',
          ar: 'تتوقف إغلاقات الورديات بعد إغلاق اليوم. وبدون إنترنت يخبرك التطبيق بذلك، وتبقى عمليات المسح على الهاتف حتى تتمكن من إرسالها.',
        },
      },
    ],
  },
  {
    id: 'slots',
    title: { en: 'Slots', es: 'Casillas (Slots)', ar: 'الخانات (Slots)' },
    items: [
      {
        id: 'slot-card', who: 'everyone', go: 'slots.html',
        q: { en: 'What\'s on a slot card?', es: '¿Qué muestra la tarjeta de una casilla?', ar: 'ماذا تعرض بطاقة الخانة؟' },
        a: {
          en: 'The slot number, the game number and ticket price, and "N Left": tickets left in the pack as of the last close. The numbers update after each close, not after every sale.',
          es: 'El número de casilla, el número de juego y el precio del boleto, y "N Left": boletos que quedaban en el paquete en el último cierre. Los números se actualizan después de cada cierre, no con cada venta.',
          ar: 'رقم الخانة، ورقم اللعبة وسعر التذكرة، و"N Left": التذاكر المتبقية في الرزمة عند آخر إغلاق. تتحدّث الأرقام بعد كل إغلاق، لا بعد كل بيعة.',
        },
      },
      {
        id: 'arrows', who: 'everyone',
        q: { en: 'What do the ↓ and ↑ arrows mean?', es: '¿Qué significan las flechas ↓ y ↑?', ar: 'ماذا يعني السهمان ↓ و↑؟' },
        a: {
          en: 'The order tickets come off the pack. ↓ (descending) goes from the last ticket down to 000. ↑ (ascending) goes from 000 up.',
          es: 'El orden en que salen los boletos del paquete. ↓ (descendente) va del último boleto hasta 000. ↑ (ascendente) va de 000 hacia arriba.',
          ar: 'ترتيب خروج التذاكر من الرزمة. ↓ (تنازلي) من آخر تذكرة نزولاً إلى 000. ↑ (تصاعدي) من 000 صعوداً.',
        },
      },
      {
        id: 'out-of-stock', who: 'everyone',
        q: { en: 'What does Out of Stock mean?', es: '¿Qué significa Out of Stock?', ar: 'ماذا يعني Out of Stock؟' },
        a: {
          en: 'The slot has no pack in it. If that game has packs in the back, the card shows how many, so you know one can go in.',
          es: 'La casilla no tiene paquete. Si ese juego tiene paquetes atrás, la tarjeta muestra cuántos, para saber que se puede poner uno.',
          ar: 'لا توجد رزمة في الخانة. إذا كانت للعبة رزم في المخزن، تعرض البطاقة عددها لتعرف أنه يمكن وضع واحدة.',
        },
      },
      {
        id: 'days', who: 'owner', go: 'settling.html',
        q: { en: 'What are "N Days" and the yellow ! mark?', es: '¿Qué son "N Days" y la marca amarilla !?', ar: 'ما معنى "N Days" وعلامة ! الصفراء؟' },
        a: {
          en: 'Days since the pack was activated. The lottery settles (charges the store for) a pack about 50–60 days after activation, so from day 50 a ! marks packs worth pushing. They\'re also listed on Settling.',
          es: 'Días desde que se activó el paquete. La lotería liquida (le cobra a la tienda) un paquete unos 50–60 días después de activarlo, así que desde el día 50 una ! marca los paquetes que conviene impulsar. También aparecen en Settling.',
          ar: 'عدد الأيام منذ تفعيل الرزمة. تحاسب اليانصيب المتجر على الرزمة بعد نحو 50–60 يوماً من تفعيلها، لذلك من اليوم 50 تظهر ! على الرزم التي يجب الدفع ببيعها. وتظهر أيضاً في Settling.',
        },
      },
      {
        id: 'view-only', who: 'employee',
        q: { en: 'Why can\'t I change anything on Slots?', es: '¿Por qué no puedo cambiar nada en Slots?', ar: 'لماذا لا أستطيع تغيير شيء في Slots؟' },
        a: {
          en: 'For employees, Slots is view only. The owner can turn on Load Packs, Return Packs or Ticket Order for you, and then you can tap a slot.',
          es: 'Para los empleados, Slots es solo para ver. El dueño puede activarte Load Packs, Return Packs o Ticket Order, y entonces podrás tocar una casilla.',
          ar: 'صفحة Slots للعرض فقط للموظفين. يمكن للمالك تفعيل Load Packs أو Return Packs أو Ticket Order لك، وعندها يمكنك الضغط على الخانة.',
        },
      },
    ],
  },
  {
    id: 'packs',
    title: { en: 'Packs (the Slot Page)', es: 'Paquetes (página de la casilla)', ar: 'الرزم (صفحة الخانة)' },
    items: [
      {
        id: 'put-in', who: ['owner', 'load_packs'], go: 'slots.html',
        q: { en: 'How do I put a new pack in a slot?', es: '¿Cómo pongo un paquete nuevo en una casilla?', ar: 'كيف أضع رزمة جديدة في خانة؟' },
        a: {
          en: 'On Slots, tap the empty slot, scan a ticket from the new pack, then tap Activate Pack. One pack comes off back stock by itself. For a game the app hasn\'t seen, it asks the ticket price first.',
          es: 'En Slots, toca la casilla vacía, escanea un boleto del paquete nuevo y toca Activate Pack. Se descuenta un paquete del inventario de atrás automáticamente. Si es un juego nuevo para la app, primero pide el precio del boleto.',
          ar: 'في Slots، اضغط على الخانة الفارغة، وامسح تذكرة من الرزمة الجديدة، ثم اضغط Activate Pack. تُخصم رزمة من المخزن تلقائياً. وإذا كانت لعبة جديدة على التطبيق، يسأل عن سعر التذكرة أولاً.',
        },
      },
      {
        id: 'sold-out-midday', who: ['owner', 'load_packs'], go: 'slots.html',
        q: { en: 'A pack sold out during the day.', es: 'Un paquete se agotó durante el día.', ar: 'نفدت رزمة خلال اليوم.' },
        a: {
          en: 'Tap its slot, then Sold Out. Before anything saves, it shows how many tickets that sells today. Tap Cancel if it\'s wrong. Then you can put the next pack in.',
          es: 'Toca su casilla y luego Sold Out. Antes de guardar, muestra cuántos boletos se venden hoy con eso. Toca Cancel si está mal. Después puedes poner el siguiente paquete.',
          ar: 'اضغط على خانتها ثم Sold Out. قبل الحفظ يعرض عدد التذاكر التي تُحسب مبيعات اليوم. اضغط Cancel إذا كان خطأ. بعدها يمكنك وضع الرزمة التالية.',
        },
      },
      {
        id: 'return', who: ['owner', 'return_packs'], go: 'slots.html',
        q: { en: 'How do I return a pack to the lottery?', es: '¿Cómo devuelvo un paquete a la lotería?', ar: 'كيف أُرجع رزمة إلى اليانصيب؟' },
        a: {
          en: 'Tap its slot, then Returned, and scan the top ticket. Tickets above it count as sold today; the rest go back. It shows both numbers before saving.',
          es: 'Toca su casilla, luego Returned, y escanea el boleto de arriba. Los boletos anteriores cuentan como vendidos hoy; el resto se devuelve. Muestra ambos números antes de guardar.',
          ar: 'اضغط على خانتها ثم Returned، وامسح التذكرة العلوية. التذاكر التي قبلها تُحسب مبيعات اليوم، والباقي يُرجع. يعرض الرقمين قبل الحفظ.',
        },
      },
      {
        id: 'wrong-slot', who: ['owner', 'load_packs'],
        q: { en: 'I put a pack in the wrong slot.', es: 'Puse un paquete en la casilla equivocada.', ar: 'وضعت رزمة في الخانة الخطأ.' },
        a: {
          en: 'Open that slot and tap Wrong Slot — Undo This Activation. This works until the slot\'s first close. The pack goes back to back stock if it came from there, and the slot\'s old price comes back.',
          es: 'Abre esa casilla y toca Wrong Slot — Undo This Activation. Funciona hasta el primer cierre de la casilla. El paquete vuelve al inventario de atrás si salió de ahí, y la casilla recupera su precio anterior.',
          ar: 'افتح تلك الخانة واضغط Wrong Slot — Undo This Activation. يعمل حتى أول إغلاق للخانة. تعود الرزمة إلى المخزن إذا أُخذت منه، ويعود سعر الخانة القديم.',
        },
      },
      {
        id: 'put-back', who: ['owner', 'load_packs', 'return_packs'],
        q: { en: 'I marked a pack Sold Out or Returned by mistake.', es: 'Marqué un paquete Sold Out o Returned por error.', ar: 'ضغطت Sold Out أو Returned لرزمة بالخطأ.' },
        a: {
          en: 'Open the slot and tap Mistake? Put Back Pack. It\'s there while the slot is still empty and that day isn\'t closed. If a new pack already went in, undo that one first.',
          es: 'Abre la casilla y toca Mistake? Put Back Pack. Aparece mientras la casilla siga vacía y ese día no esté cerrado. Si ya pusiste un paquete nuevo, deshaz ese primero.',
          ar: 'افتح الخانة واضغط Mistake? Put Back Pack. يظهر ما دامت الخانة فارغة ولم يُغلق ذلك اليوم. إذا وُضعت رزمة جديدة، ألغِها أولاً.',
        },
      },
      {
        id: 'move-swap', who: 'owner',
        q: { en: 'How do I move a pack or swap two slots?', es: '¿Cómo muevo un paquete o intercambio dos casillas?', ar: 'كيف أنقل رزمة أو أبدّل خانتين؟' },
        a: {
          en: 'On the slot page, under Move or Swap, pick the other slot and tap Swap. An empty slot works too (that\'s a move). To undo it, swap the same two slots again.',
          es: 'En la página de la casilla, en Move or Swap, elige la otra casilla y toca Swap. También sirve una casilla vacía (eso es mover). Para deshacerlo, intercambia otra vez las mismas dos casillas.',
          ar: 'في صفحة الخانة، تحت Move or Swap، اختر الخانة الأخرى واضغط Swap. تصلح الخانة الفارغة أيضاً (وهذا نقل). للتراجع، بدّل الخانتين نفسيهما مرة أخرى.',
        },
      },
      {
        id: 'price-size', who: 'owner',
        q: { en: 'How do I change a slot\'s price or a pack size?', es: '¿Cómo cambio el precio de una casilla o el tamaño de un paquete?', ar: 'كيف أغيّر سعر الخانة أو حجم الرزمة؟' },
        a: {
          en: 'On the slot page, under Slot Price and Pack Size. A pack size is refused if the pack\'s top ticket wouldn\'t fit in it.',
          es: 'En la página de la casilla, en Slot Price y Pack Size. Un tamaño de paquete se rechaza si el boleto de arriba no cabría en él.',
          ar: 'في صفحة الخانة، تحت Slot Price وPack Size. يُرفض حجم الرزمة إذا كانت التذكرة العلوية لا تتسع فيه.',
        },
      },
      {
        id: 'ticket-order', who: ['owner', 'ticket_order'], go: 'more.html',
        q: { en: 'How do I change the ticket order (↓ / ↑)?', es: '¿Cómo cambio el orden de los boletos (↓ / ↑)?', ar: 'كيف أغيّر ترتيب التذاكر (↓ / ↑)؟' },
        a: {
          en: 'On the slot page while the slot is empty. To set every slot at once, use More → Ticket Order: empty slots change now, others from their next pack.',
          es: 'En la página de la casilla mientras esté vacía. Para todas las casillas a la vez, usa More → Ticket Order: las vacías cambian ya, las demás desde su próximo paquete.',
          ar: 'في صفحة الخانة وهي فارغة. لضبط كل الخانات مرة واحدة استخدم More ← Ticket Order: الخانات الفارغة تتغيّر فوراً، والباقي من رزمتها التالية.',
        },
      },
      {
        id: 'activation-date', who: 'owner',
        q: { en: 'What\'s Activation Date for?', es: '¿Para qué sirve Activation Date?', ar: 'ما فائدة Activation Date؟' },
        a: {
          en: 'Sometimes the lottery activates a slow pack while it\'s still in the back. Set the day it was really activated, so its days and Settling are right. Sales don\'t change.',
          es: 'A veces la lotería activa un paquete lento cuando todavía está atrás. Pon el día real de activación para que sus días y Settling sean correctos. Las ventas no cambian.',
          ar: 'أحياناً تفعّل اليانصيب رزمة بطيئة وهي ما زالت في المخزن. اضبط يوم التفعيل الحقيقي لتكون أيامها وSettling صحيحة. المبيعات لا تتغيّر.',
        },
      },
    ],
  },
  {
    id: 'backstock',
    title: { en: 'Back Stock', es: 'Inventario de atrás (Back Stock)', ar: 'المخزن (Back Stock)' },
    items: [
      {
        id: 'shipment', who: ['owner', 'receive_shipments'], go: 'backstock.html?mode=shipment',
        q: { en: 'How do I enter a shipment?', es: '¿Cómo registro un envío?', ar: 'كيف أسجّل شحنة؟' },
        a: {
          en: 'Stock → Shipment Received. Scan one ticket from each game (or type the game number), set Packs Received with − and +, and tap Save. A new game also asks its ticket price and pack size.',
          es: 'Stock → Shipment Received. Escanea un boleto de cada juego (o escribe el número de juego), ajusta Packs Received con − y +, y toca Save. Un juego nuevo también pide el precio del boleto y el tamaño del paquete.',
          ar: 'Stock ← Shipment Received. امسح تذكرة واحدة من كل لعبة (أو اكتب رقم اللعبة)، واضبط Packs Received بـ − و+، ثم اضغط Save. اللعبة الجديدة تسأل أيضاً عن سعر التذكرة وحجم الرزمة.',
        },
      },
      {
        id: 'count', who: ['owner', 'count_stock'], go: 'backstock.html?mode=count',
        q: { en: 'How do I count what\'s in the back?', es: '¿Cómo cuento lo que hay atrás?', ar: 'كيف أعدّ ما في المخزن؟' },
        a: {
          en: 'Stock → Manage Stock. Scan one ticket per game, type how many packs you counted, then tap Save Count. The app takes your count as the right number.',
          es: 'Stock → Manage Stock. Escanea un boleto por juego, escribe cuántos paquetes contaste y toca Save Count. La app toma tu conteo como el número correcto.',
          ar: 'Stock ← Manage Stock. امسح تذكرة واحدة لكل لعبة، واكتب عدد الرزم التي عددتها، ثم اضغط Save Count. يعتمد التطبيق عدّك كالرقم الصحيح.',
        },
      },
      {
        id: 'manage-packs', who: 'owner', go: 'backstock.html',
        q: { en: 'How do I add or remove a pack by hand?', es: '¿Cómo agrego o quito un paquete a mano?', ar: 'كيف أضيف أو أزيل رزمة يدوياً؟' },
        a: {
          en: 'Tap Manage Packs on the game and use − and +. Adding counts as a shipment. Removing asks why (returned, game expired, damaged, stolen or other), and nothing changes until you pick a reason.',
          es: 'Toca Manage Packs en el juego y usa − y +. Agregar cuenta como envío. Quitar pregunta el motivo (devuelto, juego vencido, dañado, robado u otro), y nada cambia hasta que elijas uno.',
          ar: 'اضغط Manage Packs على اللعبة واستخدم − و+. الإضافة تُحسب شحنة. الإزالة تسأل عن السبب (مُرجعة، لعبة منتهية، تالفة، مسروقة أو غير ذلك)، ولا يتغيّر شيء حتى تختار سبباً.',
        },
      },
      {
        id: 'full-pack', who: ['owner', 'full_pack_sale'], go: 'backstock.html?mode=fullpack',
        q: { en: 'A customer bought a whole sealed pack.', es: 'Un cliente compró un paquete completo sellado.', ar: 'اشترى زبون رزمة كاملة مغلقة.' },
        a: {
          en: 'Stock → Full Pack Sale. Scan a ticket from that pack (the full number, not just the game), check the pop-up, and tap Sell. It counts in today\'s sales and the pack comes off back stock.',
          es: 'Stock → Full Pack Sale. Escanea un boleto de ese paquete (el número completo, no solo el juego), revisa la ventana y toca Sell. Cuenta en las ventas de hoy y el paquete sale del inventario de atrás.',
          ar: 'Stock ← Full Pack Sale. امسح تذكرة من تلك الرزمة (الرقم الكامل، لا رقم اللعبة فقط)، وراجع النافذة، ثم اضغط Sell. تُحسب في مبيعات اليوم وتُخصم الرزمة من المخزن.',
        },
      },
      {
        id: 'full-pack-undo', who: 'owner', go: 'full-packs.html',
        q: { en: 'I sold a full pack by mistake.', es: 'Vendí un paquete completo por error.', ar: 'بعت رزمة كاملة بالخطأ.' },
        a: {
          en: 'On Home, tap the Full Pack Sales card, then Undo on that sale. It works until that day is closed.',
          es: 'En Home, toca la tarjeta Full Pack Sales y luego Undo en esa venta. Funciona hasta que ese día se cierre.',
          ar: 'في Home اضغط بطاقة Full Pack Sales، ثم Undo على تلك البيعة. يعمل حتى يُغلق ذلك اليوم.',
        },
      },
      {
        id: 'game-ended', who: 'owner', go: 'backstock.html',
        q: { en: 'The lottery stopped a game.', es: 'La lotería terminó un juego.', ar: 'أوقفت اليانصيب لعبة.' },
        a: {
          en: 'Tap Game Ended on it to hide it. This only works with 0 packs in the back and none in a slot. It\'s listed under Ended Games, where Bring Back undoes it. Receiving it again brings it back by itself.',
          es: 'Toca Game Ended en el juego para ocultarlo. Solo funciona con 0 paquetes atrás y ninguno en una casilla. Aparece en Ended Games, donde Bring Back lo deshace. Si vuelves a recibirlo, regresa solo.',
          ar: 'اضغط Game Ended على اللعبة لإخفائها. يعمل فقط إذا لم تبقَ رزم في المخزن ولا في أي خانة. تظهر تحت Ended Games، حيث يلغي Bring Back ذلك. وإذا استلمتها مجدداً تعود وحدها.',
        },
      },
      {
        id: 'find-game', who: 'owner', go: 'backstock.html',
        q: { en: 'Where is a game right now?', es: '¿Dónde está un juego ahora?', ar: 'أين توجد لعبة الآن؟' },
        a: {
          en: 'Type the game number in Find a Game at the top of Stock. It shows the packs in the back and which slots it\'s in.',
          es: 'Escribe el número de juego en Find a Game, arriba en Stock. Muestra los paquetes de atrás y en qué casillas está.',
          ar: 'اكتب رقم اللعبة في Find a Game أعلى صفحة Stock. يعرض الرزم في المخزن والخانات التي توجد فيها.',
        },
      },
    ],
  },
  {
    id: 'reports',
    title: { en: 'Reports', es: 'Reportes', ar: 'التقارير' },
    items: [
      {
        id: 'month-sales', who: 'owner', go: 'month.html',
        q: { en: 'Where do I see this month\'s sales?', es: '¿Dónde veo las ventas de este mes?', ar: 'أين أرى مبيعات هذا الشهر؟' },
        a: {
          en: 'Reports → Months & Totals. It shows this month\'s totals and a line per day, with past months below.',
          es: 'Reports → Months & Totals. Muestra los totales del mes y una línea por día, con los meses anteriores abajo.',
          ar: 'Reports ← Months & Totals. يعرض مجاميع هذا الشهر وسطراً لكل يوم، والأشهر السابقة في الأسفل.',
        },
      },
      {
        id: 'month-excel', who: 'owner', backend: 'supabase', go: 'month.html',
        q: { en: 'How do I get a month as an Excel file?', es: '¿Cómo obtengo un mes en archivo de Excel?', ar: 'كيف أحصل على شهر كملف Excel؟' },
        a: {
          en: 'On Months & Totals, tap Download Month on that month. On iPhone, the share sheet lets you save it to Files or email it.',
          es: 'En Months & Totals, toca Download Month en ese mes. En iPhone, el menú de compartir te deja guardarlo en Archivos o enviarlo por correo.',
          ar: 'في Months & Totals اضغط Download Month على ذلك الشهر. على iPhone تتيح لك قائمة المشاركة حفظه في الملفات أو إرساله بالبريد.',
        },
      },
      {
        id: 'month-excel', who: 'owner', backend: 'sheets', go: 'month.html',
        q: { en: 'Where is each month\'s spreadsheet?', es: '¿Dónde está la hoja de cálculo de cada mes?', ar: 'أين جدول البيانات لكل شهر؟' },
        a: {
          en: 'Each month is its own Google spreadsheet. On Months & Totals, tap Open Spreadsheet on that month.',
          es: 'Cada mes es su propia hoja de cálculo de Google. En Months & Totals, toca Open Spreadsheet en ese mes.',
          ar: 'كل شهر له جدول بيانات Google خاص به. في Months & Totals اضغط Open Spreadsheet على ذلك الشهر.',
        },
      },
      {
        id: 'start-month', who: 'owner', backend: 'sheets', go: 'index.html',
        q: { en: 'How do I start a new month?', es: '¿Cómo empiezo un mes nuevo?', ar: 'كيف أبدأ شهراً جديداً؟' },
        a: {
          en: 'From the 1st, tap the amber Start <Month> button on Home. It copies this month\'s slots and back stock into the new month.',
          es: 'Desde el día 1, toca el botón ámbar Start <Mes> en Home. Copia las casillas y el inventario de atrás de este mes al mes nuevo.',
          ar: 'من اليوم الأول، اضغط الزر الكهرماني Start <الشهر> في Home. ينسخ خانات هذا الشهر ومخزونه إلى الشهر الجديد.',
        },
      },
      {
        id: 'shipments-returns', who: 'owner', go: 'reports.html',
        q: { en: 'Where do I see shipments and returns?', es: '¿Dónde veo envíos y devoluciones?', ar: 'أين أرى الشحنات والمرتجعات؟' },
        a: {
          en: 'Reports → Shipments Received or Returned Packs. Each shows one card per day; tap a day for its full table. Returns from a slot and sealed packs returned from the back are both listed.',
          es: 'Reports → Shipments Received o Returned Packs. Cada uno muestra una tarjeta por día; toca un día para ver su tabla completa. Se listan tanto las devoluciones desde una casilla como los paquetes sellados devueltos desde atrás.',
          ar: 'Reports ← Shipments Received أو Returned Packs. يعرض كل منهما بطاقة لكل يوم؛ اضغط على يوم لرؤية جدوله كاملاً. تظهر المرتجعات من الخانات والرزم المغلقة المرتجعة من المخزن معاً.',
        },
      },
      {
        id: 'settling', who: 'owner', go: 'settling.html',
        q: { en: 'What is Settling?', es: '¿Qué es Settling?', ar: 'ما هو Settling؟' },
        a: {
          en: 'The Settling card on Home lists packs in slots for 50 days or more, longest first. From day 60 they\'re red: most likely already settled (charged to the store). Push these packs or return them.',
          es: 'La tarjeta Settling en Home lista los paquetes que llevan 50 días o más en casillas, los más antiguos primero. Desde el día 60 salen en rojo: lo más probable es que ya se hayan cobrado a la tienda. Impulsa esos paquetes o devuélvelos.',
          ar: 'بطاقة Settling في Home تعرض الرزم الموجودة في الخانات منذ 50 يوماً أو أكثر، الأقدم أولاً. من اليوم 60 تظهر بالأحمر: غالباً تمت محاسبة المتجر عليها. ادفع ببيعها أو أرجعها.',
        },
      },
      {
        id: 'shift-closes', who: 'owner', go: 'shifts.html',
        q: { en: 'Where do I see shift closes?', es: '¿Dónde veo los cierres de turno?', ar: 'أين أرى إغلاقات الورديات؟' },
        a: {
          en: 'The Shift Closure card on Home. Each one shows who, when, tickets and $, and every slot\'s start and end ticket. Delete removes a mistaken one.',
          es: 'La tarjeta Shift Closure en Home. Cada cierre muestra quién, cuándo, boletos y $, y el boleto inicial y final de cada casilla. Delete borra uno equivocado.',
          ar: 'بطاقة Shift Closure في Home. يعرض كل إغلاق من أغلقه ومتى، والتذاكر و$، وتذكرة البداية والنهاية لكل خانة. يحذف Delete الإغلاق الخاطئ.',
        },
      },
      {
        id: 'theft-when', who: ['owner', 'theft_report'], go: 'theft-report.html',
        q: { en: 'When do I use the Theft Report?', es: '¿Cuándo uso el Theft Report?', ar: 'متى أستخدم Theft Report؟' },
        a: {
          en: 'When tickets or packs are stolen or missing. Tap the red button on Home (or Reports → Theft Report), choose Live Scratchers or Full Inventory, and tap Make Report. It lists every pack\'s unsold ticket numbers for the lottery to stop.',
          es: 'Cuando roban o faltan boletos o paquetes. Toca el botón rojo en Home (o Reports → Theft Report), elige Live Scratchers o Full Inventory y toca Make Report. Lista los números de boletos sin vender de cada paquete para que la lotería los bloquee.',
          ar: 'عند سرقة تذاكر أو رزم أو فقدانها. اضغط الزر الأحمر في Home (أو Reports ← Theft Report)، واختر Live Scratchers أو Full Inventory، ثم اضغط Make Report. يعرض أرقام التذاكر غير المبيعة لكل رزمة لتوقفها اليانصيب.',
        },
      },
      {
        id: 'theft-send', who: ['owner', 'theft_report'],
        q: { en: 'How do I send the Theft Report?', es: '¿Cómo envío el Theft Report?', ar: 'كيف أرسل Theft Report؟' },
        a: {
          en: 'Tap Share to send it as text, or Print / Save PDF for a PDF you can print, save or email. Employees see the same report without dollar amounts.',
          es: 'Toca Share para enviarlo como texto, o Print / Save PDF para un PDF que puedes imprimir, guardar o enviar por correo. Los empleados ven el mismo reporte sin montos en dólares.',
          ar: 'اضغط Share لإرساله كنص، أو Print / Save PDF لملف PDF يمكنك طباعته أو حفظه أو إرساله بالبريد. يرى الموظفون التقرير نفسه بدون مبالغ بالدولار.',
        },
      },
      {
        id: 'retailer-number', who: 'owner', go: 'more.html',
        q: { en: 'Where do I enter the retailer number?', es: '¿Dónde pongo el número de minorista?', ar: 'أين أُدخل رقم البائع (Retailer Number)؟' },
        a: {
          en: 'More → Retailer Number. It prints on every Theft Report.',
          es: 'More → Retailer Number. Aparece en cada Theft Report.',
          ar: 'More ← Retailer Number. يُطبع على كل Theft Report.',
        },
      },
    ],
  },
  {
    id: 'employees',
    title: { en: 'Employees', es: 'Empleados', ar: 'الموظفون' },
    items: [
      {
        id: 'add', who: 'owner', backend: 'supabase', go: 'users.html',
        q: { en: 'How do I add an employee?', es: '¿Cómo agrego un empleado?', ar: 'كيف أضيف موظفاً؟' },
        a: {
          en: 'More → Manage Employees. Type a username and their email, then tap Add Employee. They get an email to choose their own password, and show as Invited until they sign in.',
          es: 'More → Manage Employees. Escribe un nombre de usuario y su correo, y toca Add Employee. Recibe un correo para elegir su propia contraseña, y aparece como Invited hasta que inicie sesión.',
          ar: 'More ← Manage Employees. اكتب اسم مستخدم وبريده الإلكتروني، ثم اضغط Add Employee. تصله رسالة لاختيار كلمة المرور بنفسه، ويظهر كـ Invited حتى يسجّل الدخول.',
        },
      },
      {
        id: 'add', who: 'owner', backend: 'sheets', go: 'users.html',
        q: { en: 'How do I add an employee?', es: '¿Cómo agrego un empleado?', ar: 'كيف أضيف موظفاً؟' },
        a: {
          en: 'More → Manage Employees. Type a username and a starting password, tap Add Employee, and tell them the password. They can change it under Change My Password.',
          es: 'More → Manage Employees. Escribe un nombre de usuario y una contraseña inicial, toca Add Employee y dile la contraseña. Puede cambiarla en Change My Password.',
          ar: 'More ← Manage Employees. اكتب اسم مستخدم وكلمة مرور أولى، واضغط Add Employee، وأخبره بكلمة المرور. يمكنه تغييرها من Change My Password.',
        },
      },
      {
        id: 'no-invite', who: 'owner', backend: 'supabase', go: 'users.html',
        q: { en: 'My employee didn\'t get the invite.', es: 'A mi empleado no le llegó la invitación.', ar: 'لم تصل الدعوة إلى موظفي.' },
        a: {
          en: 'Ask them to check Spam first. Then tap Resend Invite on their card for a new email (the old link stops working). Or tap Reset Password and give them a password yourself.',
          es: 'Pídele que revise Spam primero. Luego toca Resend Invite en su tarjeta para un correo nuevo (el enlace anterior deja de funcionar). O toca Reset Password y dale tú una contraseña.',
          ar: 'اطلب منه التحقّق من Spam أولاً. ثم اضغط Resend Invite على بطاقته لإرسال رسالة جديدة (يتوقف الرابط القديم). أو اضغط Reset Password وأعطه كلمة مرور بنفسك.',
        },
      },
      {
        id: 'employee-forgot', who: 'owner', backend: 'supabase', go: 'users.html',
        q: { en: 'An employee forgot their password.', es: 'Un empleado olvidó su contraseña.', ar: 'نسي موظف كلمة المرور.' },
        a: {
          en: 'They can tap Forgot Password? on Sign In. Or tap Reset Password on their card, type a new one and tell them.',
          es: 'Puede tocar Forgot Password? en Sign In. O toca Reset Password en su tarjeta, escribe una nueva y díselo.',
          ar: 'يمكنه الضغط على Forgot Password? في صفحة Sign In. أو اضغط Reset Password على بطاقته، واكتب كلمة جديدة وأخبره بها.',
        },
      },
      {
        id: 'employee-forgot', who: 'owner', backend: 'sheets', go: 'users.html',
        q: { en: 'An employee forgot their password.', es: 'Un empleado olvidó su contraseña.', ar: 'نسي موظف كلمة المرور.' },
        a: {
          en: 'Tap Reset Password on their card, type a new one and tell them.',
          es: 'Toca Reset Password en su tarjeta, escribe una nueva y díselo.',
          ar: 'اضغط Reset Password على بطاقته، واكتب كلمة جديدة وأخبره بها.',
        },
      },
      {
        id: 'deactivate', who: 'owner', go: 'users.html',
        q: { en: 'Someone left, or shouldn\'t sign in for now.', es: 'Alguien se fue o no debe entrar por ahora.', ar: 'غادر شخص ما، أو لا يجب أن يدخل الآن.' },
        a: {
          en: 'Tap Deactivate on their card. They\'re signed out on their next tap and can\'t sign in. Reactivate brings them back, with their history kept.',
          es: 'Toca Deactivate en su tarjeta. Se cierra su sesión en su siguiente toque y no puede entrar. Reactivate lo trae de vuelta, con su historial guardado.',
          ar: 'اضغط Deactivate على بطاقته. يُسجَّل خروجه عند ضغطته التالية ولا يمكنه الدخول. يعيده Reactivate مع الاحتفاظ بسجله.',
        },
      },
      {
        id: 'employee-default', who: 'owner', go: 'users.html',
        q: { en: 'What can employees do?', es: '¿Qué pueden hacer los empleados?', ar: 'ماذا يستطيع الموظفون أن يفعلوا؟' },
        a: {
          en: 'By default: Close Day, Close My Shift, and view Slots, with no $ anywhere. Open Permissions on their card to turn on more, one switch each. It saves right away.',
          es: 'Por defecto: Close Day, Close My Shift y ver Slots, sin $ en ningún lado. Abre Permissions en su tarjeta para activar más, un interruptor cada uno. Se guarda al instante.',
          ar: 'افتراضياً: Close Day وClose My Shift وعرض Slots، بدون $ في أي مكان. افتح Permissions على بطاقته لتفعيل المزيد، مفتاح لكل صلاحية. يُحفظ فوراً.',
        },
      },
      {
        id: 'permissions', who: 'owner', go: 'users.html',
        q: { en: 'What does each permission allow?', es: '¿Qué permite cada permiso?', ar: 'ماذا تتيح كل صلاحية؟' },
        a: {
          en: '- Load Packs: mark a pack Sold Out and put a new pack in a slot; undo a wrong slot or a sold out from today.\n'
            + '- Return Packs: mark a pack Returned, and put a returned pack back.\n'
            + '- Receive Shipments: Shipment Received on Stock (no back stock list).\n'
            + '- Manage Stock: count the back and set how many packs are there.\n'
            + '- Full Pack Sale: sell a sealed pack from the back (Undo stays yours).\n'
            + '- Ticket Order: set ↓ / ↑ on an empty slot, or all slots on More.\n'
            + '- Theft Report: make the Theft Report, without $.',
          es: '- Load Packs: marcar un paquete Sold Out y poner uno nuevo en una casilla; deshacer una casilla equivocada o un agotado de hoy.\n'
            + '- Return Packs: marcar un paquete Returned y volver a poner uno devuelto.\n'
            + '- Receive Shipments: Shipment Received en Stock (sin la lista del inventario).\n'
            + '- Manage Stock: contar lo de atrás y fijar cuántos paquetes hay.\n'
            + '- Full Pack Sale: vender un paquete sellado de atrás (Undo sigue siendo tuyo).\n'
            + '- Ticket Order: poner ↓ / ↑ en una casilla vacía, o en todas desde More.\n'
            + '- Theft Report: hacer el Theft Report, sin $.',
          ar: '- Load Packs: الضغط على Sold Out ووضع رزمة جديدة في خانة؛ والتراجع عن خانة خاطئة أو نفاد اليوم.\n'
            + '- Return Packs: الضغط على Returned، وإعادة رزمة مُرجعة.\n'
            + '- Receive Shipments: Shipment Received في Stock (بدون قائمة المخزن).\n'
            + '- Manage Stock: عدّ المخزن وتحديد عدد الرزم فيه.\n'
            + '- Full Pack Sale: بيع رزمة مغلقة من المخزن (Undo يبقى لك).\n'
            + '- Ticket Order: ضبط ↓ / ↑ لخانة فارغة، أو لكل الخانات من More.\n'
            + '- Theft Report: إعداد Theft Report، بدون $.',
        },
      },
    ],
  },
  {
    id: 'problems',
    title: { en: 'Fixing Problems', es: 'Solución de problemas', ar: 'حل المشكلات' },
    items: [
      {
        id: 'try-again', who: 'everyone',
        q: { en: 'A page says it couldn\'t load.', es: 'Una página dice que no pudo cargar.', ar: 'صفحة تقول إنها لم تُحمَّل.' },
        a: {
          en: 'Tap Try Again at the top of the page. It\'s usually a weak connection; move closer to the Wi-Fi or wait a moment.',
          es: 'Toca Try Again arriba en la página. Casi siempre es una conexión débil; acércate al Wi-Fi o espera un momento.',
          ar: 'اضغط Try Again أعلى الصفحة. السبب غالباً اتصال ضعيف؛ اقترب من الواي فاي أو انتظر قليلاً.',
        },
      },
      {
        id: 'dimmed', who: 'everyone',
        q: { en: 'Why are the numbers dimmed?', es: '¿Por qué los números se ven apagados?', ar: 'لماذا تظهر الأرقام باهتة؟' },
        a: {
          en: 'You\'re seeing the last numbers saved on this phone while the fresh ones load. Buttons wait until the fresh numbers arrive.',
          es: 'Estás viendo los últimos números guardados en este teléfono mientras cargan los nuevos. Los botones esperan a que lleguen los números nuevos.',
          ar: 'ترى آخر أرقام محفوظة على هذا الهاتف ريثما تُحمَّل الجديدة. تنتظر الأزرار حتى تصل الأرقام الجديدة.',
        },
      },
      {
        id: 'camera-froze', who: 'everyone',
        q: { en: 'The camera picture froze.', es: 'La imagen de la cámara se congeló.', ar: 'تجمّدت صورة الكاميرا.' },
        a: {
          en: 'It restarts by itself within a second or two. If it doesn\'t, leave the page and open it again.',
          es: 'Se reinicia sola en uno o dos segundos. Si no, sal de la página y ábrela otra vez.',
          ar: 'تعود للعمل وحدها خلال ثانية أو ثانيتين. وإن لم تعد، اخرج من الصفحة وافتحها من جديد.',
        },
      },
      {
        id: 'wont-read', who: 'everyone',
        q: { en: 'The camera won\'t read a barcode.', es: 'La cámara no lee un código de barras.', ar: 'الكاميرا لا تقرأ الباركود.' },
        a: {
          en: 'Hold the ticket flat and steady, with the barcode inside the guide box and out of glare. Or type the number printed on the ticket.',
          es: 'Sostén el boleto plano y quieto, con el código dentro del recuadro guía y sin reflejos. O escribe el número impreso en el boleto.',
          ar: 'أمسك التذكرة مستوية وثابتة، والباركود داخل المربع الإرشادي وبعيداً عن اللمعان. أو اكتب الرقم المطبوع على التذكرة.',
        },
      },
      {
        id: 'no-buzz', who: 'everyone',
        q: { en: 'My phone doesn\'t buzz on a scan.', es: 'Mi teléfono no vibra al escanear.', ar: 'هاتفي لا يهتز عند المسح.' },
        a: {
          en: 'On iPhone, the buzz only comes with Press and Hold, when you lift your finger. With Auto Scan or a typed number you hear the beeps only.',
          es: 'En iPhone, la vibración solo llega con Press and Hold, al levantar el dedo. Con Auto Scan o un número escrito solo se oyen los pitidos.',
          ar: 'على iPhone تأتي الاهتزازة فقط مع Press and Hold عند رفع إصبعك. مع Auto Scan أو الرقم المكتوب تسمع الصفارات فقط.',
        },
      },
      {
        id: 'other-day', who: 'everyone',
        q: { en: 'My close said it was scanned on another day.', es: 'Mi cierre dice que se escaneó otro día.', ar: 'يقول إغلاقي إنه مُسح في يوم آخر.' },
        a: {
          en: 'A close that couldn\'t be sent the day it was scanned isn\'t saved under the wrong day. Its sales are counted in the next close, so nothing is lost.',
          es: 'Un cierre que no se pudo enviar el día en que se escaneó no se guarda en el día equivocado. Sus ventas se cuentan en el siguiente cierre, así que no se pierde nada.',
          ar: 'الإغلاق الذي لم يُرسل في يوم مسحه لا يُحفظ في يوم خاطئ. تُحسب مبيعاته في الإغلاق التالي، فلا يضيع شيء.',
        },
      },
      {
        id: 'update', who: 'everyone',
        q: { en: 'How do I get the newest version of the app?', es: '¿Cómo obtengo la versión más nueva de la app?', ar: 'كيف أحصل على أحدث نسخة من التطبيق؟' },
        a: {
          en: 'Updates arrive by themselves. If the owner says something new is live, fully close the app and open it again; it shows from the next page you open.',
          es: 'Las actualizaciones llegan solas. Si el dueño dice que hay algo nuevo, cierra la app por completo y ábrela otra vez; aparece desde la siguiente página que abras.',
          ar: 'تصل التحديثات وحدها. إذا قال المالك إن هناك شيئاً جديداً، أغلق التطبيق تماماً وافتحه من جديد؛ يظهر من الصفحة التالية التي تفتحها.',
        },
      },
    ],
  },
  {
    id: 'about',
    title: { en: 'About', es: 'Acerca de', ar: 'حول التطبيق' },
    items: [
      {
        id: 'not-lottery', who: 'everyone',
        q: { en: 'Is Smart Scan the lottery\'s app?', es: '¿Smart Scan es la app de la lotería?', ar: 'هل Smart Scan تطبيق اليانصيب؟' },
        a: {
          en: 'No. Smart Scan is an independent bookkeeping tool for retailers. It isn\'t affiliated with, endorsed by or approved by any lottery, and it doesn\'t sell tickets or offer any game.',
          es: 'No. Smart Scan es una herramienta independiente de contabilidad para comercios. No está afiliada, respaldada ni aprobada por ninguna lotería, y no vende boletos ni ofrece juegos.',
          ar: 'لا. Smart Scan أداة مستقلة لمسك الدفاتر للمتاجر. ليست تابعة لأي يانصيب ولا مُعتمدة أو مُوافقاً عليها منه، ولا تبيع تذاكر ولا تقدّم أي لعبة.',
        },
      },
      {
        id: 'dollars', who: 'everyone',
        q: { en: 'Who sees the dollar amounts?', es: '¿Quién ve los montos en dólares?', ar: 'من يرى المبالغ بالدولار؟' },
        a: {
          en: 'Only the owner. Employees see tickets and packs, never dollar amounts.',
          es: 'Solo el dueño. Los empleados ven boletos y paquetes, nunca montos en dólares.',
          ar: 'المالك فقط. يرى الموظفون التذاكر والرزم، ولا يرون المبالغ بالدولار أبداً.',
        },
      },
    ],
  },
];

// Whether this person sees an item: the owner sees everything; an employee sees 'everyone' and 'employee' items and
// those for a permission the owner turned on. backend: only on that backend.
function faqVisible(item, session, backend) {
  if (item.backend && item.backend !== backend) return false;
  if (!session) return false;
  if (session.role === 'owner') return true;
  const who = [].concat(item.who);
  const permissions = session.permissions || [];
  return who.includes('everyone') || who.includes('employee') || who.some((w) => permissions.includes(w));
}

if (typeof module !== 'undefined') module.exports = { FAQ, HELP_LANGS, HELP_WORDS, faqVisible };
