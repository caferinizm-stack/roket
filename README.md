# Retra · Roket (Web, 3D)

Canlı **crash** oyunu: herkes **aynı turda** oynar. Bahis süresi → roket kalkar,
oran `1.00x`'ten yükselir → patlamadan önce **ÇEKİL**. Bahisler uygulamanın
gerçek kristalleriyle (`profiles.crystals`) yapılır. Derleme adımı yoktur:
`index.html` + `style.css` + `app.js` + `scene.js` + `assets/`.

3D sahne **three.js** (jsdelivr, `three@0.169.0`) ile çizilir: roket, rampa,
irtifaya göre renk değiştiren gökyüzü, bulutlar, yıldızlar, gezegen, hız
çizgileri, egzoz/duman parçacıkları ve patlama. WebGL yoksa oyun yine
oynanır (oran, eğri grafiği ve butonlar çalışır).

## Kurulum

1. **Sunucu:** `sql_kopyala.html` ▸ **FAZ 82: ROKET WEB** bölümünü Supabase SQL
   Editor'de bir kez çalıştır (`supabase_faz82_roket_web.sql`). Yalnızca okunur
   `rocket_live()` fonksiyonunu ekler; tur, bahis ve çekilme kuralları
   değişmez (`rocket_state`, `rocket_bet`, `rocket_cashout`).
2. **Yayın:** bu klasörün içeriğini GitHub'da **`roket`** adlı depoya yükle ve
   Settings ▸ Pages ▸ Branch: `main` / `(root)` seç. Adres:
   `https://caferinizm-stack.github.io/roket/`
   (başka adres kullanırsan `lib/screens/roulette_screen.dart` ▸ `kRocketUrl`).
3. Uygulama: Şans Oyunları ▸ **Roket** kartı ya da odadaki oyun menüsü. Sayfa
   `?app=1` ile açılır, oturum adresin `#` kısmından gelir.

`?demo=1` ile sunucusuz deneme modu açılır (sahte oyuncular, tarayıcıda bakiye).
Yerelde: `python3 -m http.server` → `http://127.0.0.1:8000/?demo=1`.

## Özellikler

* Büyük, renk değiştiren oran göstergesi (mor → mavi → yeşil → altın) ve canlı
  oran eğrisi.
* Canlı oyuncular: bu turda kim ne kadar bastı, kim kaçta çekildi, ne kazandı.
  Çekilenler sahnede akış balonu olarak görünür.
* Son 20 tur şeridi, dokununca son 40 tur + istatistik.
* Otomatik çekil (oran hedefi), roket uçarken **sonraki tura bahis** sırası.
* Sesler tarayıcıda üretilir (motor, geri sayım, çekilme, patlama).

## Uygulama köprüsü (`RetraGame`)

* `ready` — sayfa hazır (açılış animasyonu kapanır).
* `win:<kristal>` — çekilmede kazanılan tutar (uygulama duyurur).
* `bet` — bahis yapıldı.
* `lowbalance` — bakiye yetersiz.
