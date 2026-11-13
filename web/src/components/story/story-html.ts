// Static markup of the home page scroll story (generated from the approved design). The engine finds nodes by id.
export const STORY_HTML = `<header class="bar">
  <button class="cell" type="button" data-go="0">SnackStream<sup style="font-size:8px;margin-left:1px">™</sup></button>
  <button class="cell hide-m" type="button" data-go="0.36">Thành phần</button>
  <button class="cell hide-m" type="button" data-to="pg">Cửa hàng</button>
  <button class="cell hide-m" type="button" data-to="ch">Chatbot</button>
  <button class="cell hide-m" type="button" data-to="lv">Live</button>
  <span class="sp"></span>
  <button class="cell hide-m" type="button" data-to="cl">Tra cứu đơn</button>
  <button class="cell" type="button" data-to="pg">Giỏ (0)</button>
</header>
<div id="track"><div id="pin">
<div id="scene"><canvas id="stage" aria-hidden="true"></canvas>
<section class="layer" id="hero" aria-label="Mở đầu">
  <p>Đồ ăn vặt đường phố.<br>Giao toàn quốc, trả tiền khi nhận.</p>
  <h1>SnackStream<sup>™</sup></h1>
</section>
<section class="layer" id="s1" aria-label="Con số">
  <p class="cap">Mỗi túi SnackStream làm được mọi điều một túi snack làm được, với thành phần đối chiếu theo bao bì thật.</p>
  <p class="big l">30<br>mã sản phẩm</p>
  <p class="big r">10 nhóm<br>hàng<sup>[1]</sup></p>
  <p class="foot">[1] Số liệu từ danh mục SKU hiện tại của cửa hàng, gồm bánh tráng, khô gà, khô bò, trái cây sấy, snack và kẹo.</p>
</section>
<section class="layer" id="s2" aria-label="Chi tiết túi">
  <div class="call" style="left:max(24px,env(safe-area-inset-left,0px));top:36%"><div><b>Thành phần</b><span>Ức gà, lá chanh, ớt xanh và gia vị, ghi đúng theo bao bì.</span></div><i></i></div>
  <div class="call r" style="right:max(24px,env(safe-area-inset-right,0px));top:46%"><div><b>Hạn dùng</b><span>6 tháng, tính theo nhãn của từng lô hàng.</span></div><i></i></div>
  <div class="call" style="left:max(24px,env(safe-area-inset-left,0px));top:68%"><div><b>Bảo quản</b><span>Đậy kín, để nơi khô ráo, thoáng mát.</span></div><i></i></div>
</section>
<section class="layer" id="s3" aria-label="Nguyên liệu">
  <p class="tl a">Ức gà xé sợi, sấy giòn cùng lá chanh và ớt xanh.</p>
  <p class="tl b">Mỗi nguyên liệu đều có trên nhãn, từ thành phần tới cách bảo quản.</p>
</section>
<section class="layer" id="pq" aria-label="Một túi, một mình">
  <p class="tr">Mỗi túi 250g. Hạn dùng 6 tháng, tính theo nhãn của từng lô hàng.</p>
</section>
<section class="layer" id="pr" aria-label="Rót ra bát">
  <p class="tr">Mở túi và rót ra bát. Khô gà xé sợi, sấy giòn, thơm lá chanh.</p>
  <p class="bn"><small>Đã rót</small><span id="prG">0g</span></p>
  <p class="ft">Số gam minh họa theo nhịp cuộn.</p>
</section>
</div>
<section class="layer panel" id="pA" aria-label="Minh bạch">
  <div class="split">
    <div class="txt"><p class="eyebrow">Minh bạch</p><h2 id="rv"></h2><p class="fn">[2] Thành phần, mức cay và thông tin dị ứng chỉ hiển thị là đã xác minh sau khi đối chiếu bao bì. Phần chưa xác minh được ghi rõ trên trang từng sản phẩm.</p></div>
    <div class="pic">
      <span class="bk" style="left:8%;top:12%;width:90px;height:90px"></span><span class="bk" style="left:62%;top:8%;width:60px;height:60px;opacity:.7"></span><span class="bk" style="left:78%;top:30%;width:120px;height:120px;opacity:.5"></span>
      <span class="bk" style="left:14%;top:66%;width:110px;height:110px;opacity:.6"></span><span class="bk" style="left:52%;top:84%;width:70px;height:70px"></span><span class="bk" style="left:86%;top:76%;width:80px;height:80px;opacity:.6"></span>
      <div class="mark"><span>Đã đối chiếu</span><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="none" stroke="#fff" stroke-width="5"/><path d="M30 52 l14 14 l28 -32" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg><i></i><span>với bao bì thật</span></div>
      <small>Ảnh minh họa, sẽ thay bằng ảnh macro nguyên liệu chụp thật</small>
    </div>
  </div>
</section>
</div></div>
<section class="sec" id="pg" aria-label="Quầy hàng">
  <div class="head"><span class="eyebrow">Sản phẩm</span><a class="go" href="/products">Xem tất cả 29 sản phẩm</a></div>
  <div class="row">
    <a class="pc" href="/products"><div class="tp"><b>Bánh tráng xì ke muối nhuyễn</b><span>15.000đ</span></div><div class="im"><img src="/photos/bt-xike-01.webp" alt="Bánh tráng xì ke muối nhuyễn"></div></a>
    <a class="pc" href="/products"><div class="tp"><b>Khô gà lá chanh sấy giòn</b><span>Từ 55.000đ</span></div><div class="im"><img src="/photos/kg-lc-250.webp" alt="Khô gà lá chanh sấy giòn"></div></a>
    <a class="pc" href="/products"><div class="tp"><b>Khô bò sợi mềm</b><span>85.000đ</span></div><div class="im"><img src="/photos/kb-sl-200.webp" alt="Khô bò sợi mềm"></div></a>
    <a class="pc" href="/products"><div class="tp"><b>Xoài sấy dẻo</b><span>45.000đ</span></div><div class="im"><img src="/photos/xoai-keo-200.webp" alt="Xoài sấy dẻo"></div></a>
  </div>
</section>
<section class="sec panel" id="ch" aria-label="Chatbot">
  <div class="split">
    <div class="txt"><p class="eyebrow">Chatbot</p><h2>Hỏi gì cũng được trả lời đúng với dữ liệu sản phẩm. Thiếu dữ liệu thì nói chưa biết.<sup>[3]</sup></h2><p class="fn">[3] Chatbot chỉ trả lời từ dữ liệu sản phẩm đã có. Giá, mức cay, dị ứng và hạn dùng mà dữ liệu chưa có thì chatbot nói chưa biết, không đoán.</p></div>
    <div class="pic softpane"><div class="chatwin"><div class="ch-h"><span>Hỏi đáp sản phẩm</span><span>Trực tuyến</span></div><div class="ch-b" id="chB"></div><div class="ch-f">Nhập câu hỏi…</div></div></div>
  </div>
</section>
<section class="sec panel" id="lv" aria-label="Livestream">
  <div class="split">
    <div class="pic softpane"><div class="phone"><div class="vid"></div><img class="hb" id="lvImg" alt=""><div class="lt"><span class="live"><i></i>LIVE</span><span id="lvV">1,2K</span></div><span class="cart">Giỏ <b id="lvK">0</b></span><div class="tst" id="lvT">Đã thêm vào giỏ</div><div class="lc" id="lvC"></div><div class="pin" id="lvP"><img id="lvPi" alt=""><span><b>Khô gà lá chanh 500g</b><small>99.000đ</small></span><button type="button" tabindex="-1">+ Giỏ</button></div></div></div>
    <div class="txt"><p class="eyebrow">Livestream</p><h2>Xem live, hỏi gì đáp nấy. Thích món nào thì thêm vào giỏ ngay.<sup>[4]</sup></h2><p class="fn">[4] Host AI trả lời bình luận dựa trên cùng dữ liệu sản phẩm, ghim sản phẩm đang giới thiệu và dùng chung giỏ hàng với cửa hàng.</p></div>
  </div>
</section>
<section class="sec" id="cl" aria-label="Kết">
  <div class="nums">
    <div><p class="n" data-t="29" data-f="n">0</p><p class="t">sản phẩm trong cửa hàng</p></div>
    <div><p class="n" data-t="15000" data-f="d">0</p><p class="t">giá thấp nhất</p></div>
    <div><p class="n" data-t="99000" data-f="d">0</p><p class="t">giá cao nhất, túi khô gà 500g</p></div>
  </div>
  <div class="end"><h2>Vị phố,<br>giao tận nhà.</h2><button class="shop go" type="button">Vào cửa hàng</button></div>
  <div class="links"><span>Shop demo của đồ án môn học. Thanh toán online chỉ là sandbox.</span><span style="display:flex;gap:24px"><a href="/products">Cửa hàng</a><span style="opacity:.5">Tra cứu đơn (sắp có)</span></span></div>
  <p class="wm" aria-hidden="true">SnackStream</p>
</section>
`;
