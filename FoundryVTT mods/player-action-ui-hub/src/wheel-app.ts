import { sectorArc, sectorCentroid, ringCapPath, capOvershoot, capsFor } from "./geometry";
import type { WheelLevel, SectorData } from "./types";
import { wrapText, textWidth } from "./text";
import { glyphs, reactionGlyph } from "./economy";
import { pageOf, pageCount, normalizePage, carryPage } from "./paging";

const SVG_NS = "http://www.w3.org/2000/svg";
const CX = 100;
const CY = 100;
const SIZE = 320;   // 窗口边长（像素）

/*
 * ===== 环的几何：画笔扫掠（claude-draws skill，2026-08-05 重定）=====
 *
 * 只有 R_HUB / GUTTER / W 三个是**自由量**，其余全部由它们算出来。
 * 老版本把 R_OUTER 和 R_INNER 都当自由量填，两者耦合，调环宽必须同时动两个数。
 *
 * 三个数对着 mockup 逐层量测校准过（分层半径对拍）：
 *   毂 68.0% / 环内缘 73.0% / 环外缘 100%   ← 本组参数
 *   毂 67.7% / 环内缘 72.5% / 环外缘 100%   ← mockup 实测
 *
 * ★ 2026-08-05 第二轮（Nous 反馈）：R_OUTER 拉到 100，也就是**顶满 viewBox**——
 *   环的外缘就是 UI 边缘，不再留一圈空边。其余按 mockup 比例等比放大。
 *   顺带把环宽从 20 撑到 27，没有图标、走文字标签时不再挤出环外。
 */
const R_HUB  = 68;                    // 中心毂半径
const GUTTER = 5;                     // 毂与环之间的**切割**（留空，不画任何东西）
const W      = 13.5;                  // 笔半径 → 环宽 = 2W = 27
const R      = R_HUB + GUTTER + W;    // 环中线 = 86.5，笔尖走的那条圆
const R_OUTER = R + W;                // 100 —— 环的外缘
/**
 * SVG 用户坐标系的边长。★ 由 R_OUTER 定义，不是反过来 ——
 * 「环的外缘就是 UI 边缘」是设计意图（Nous 2026-08-05），写成 2×R_OUTER 之后
 * 这条意图就由几何保证了：改半径，画布跟着改，环永远贴边。
 * 旧代码写的是 `SIZE / 1.6`，那个 1.6 是个魔法数，和半径没有任何联系。
 *
 * 窗口像素 SIZE 与它的比值就是缩放（320 / 200 = 1.6×）。
 */
const VIEW = 2 * R_OUTER;

const AppV2 = foundry.applications.api.ApplicationV2;

/**
 * 状态区最多几行。
 * ⚠ 这是**排版能放下几行**，与 `class-state.ts` 的 `MAX_STATE_LINES`（采集端截断）
 *   是两回事：那个管"算出几条"，这个管"毂里画得下几行"。
 *   一条状态可能断成两行，所以两个数不必相等。
 */
/*
 * ⚠⚠⚠ **下面这一整组常量是 `styles/wheel.css` 的字号的函数** —— 2026-08-07 实测标定：
 *
 *   每单位宽度 ≈ 0.84 × font-size(px)
 *   行所在高度 y 处的可用宽度 = 2·√(R_HUB² − y²)  （越往上下越窄）
 *
 *   字号定稿在 **+0.5**（+2 "太大了" → +1 "只要半个字号加成就好了" → +0.5）：
 *     补充信息 7.5→8px    ⇒ 每单位 6.31→6.72px ⇒ 预算 20→19
 *     状态行   6.4→6.9px  ⇒ 每单位 5.38→5.80px ⇒ 预算 19→16
 *     扇区标签 8→8.5px    ⇒ 每单位 7.2→7.65px  ⇒ 预算 7→7（正好还够）
 *   ⚠ **这三个数不是我调出来的，是上面那两条公式算出来的** ——
 *     下次字号再动，照公式重算，别手调（手调的数字改一次跨度就全废）。
 *   行距与行位同步放开（毂里各行**仍然各有固定的家**，见下面的垂直节奏）。
 *
 * ⛔ **只改 CSS 不改这里 = 静默溢出**：文字横着长出毂外，浏览器一声不吭。
 *   反过来也一样。改动一方之前，先把另一方读完。
 */
/*
 * ⛔ 这里原来是 `MAX_HUB_STATE_LINES = 3`（状态区自己的行数上限）。
 *   2026-08-08 毂内改成**一套等距行栅格**之后，行数上限只剩一个来源：`MAX_HUB_ROWS`。
 *   ★ 留着第二个上限就等于留了第二把尺子 —— 两处各写各的，
 *     合起来会是一个谁也没写下来的隐形限制（本文件第 7 条同一个坑）。
 */
/**
 * 悬停时那行**补充信息**的断行预算（2026-08-07 截图当场看出来的缺陷）。
 *
 * ⚠ 原来这一行**根本没断行** —— 只做了 90 字符的截断，而 90 个拉丁字符
 *   等于 45 个显示单位，是毂宽的两倍多。反应的触发条件一显示，
 *   两头当场被切掉（"…hin your reach uses a manipulate action or a move action, make"）。
 *   截断长度管的是"取多少字"，**断行管的是"一行放得下多少"**，两件事。
 *
 * ★ 数值由状态行那个 19 换算：状态字号 6.4px、补充信息 7.5px，
 *   19 × 6.4 / 7.5 ≈ 16.2 → 取 17（实测每单位 6.44px，17 单位 ≈ 110px，
 *   而这几行靠近毂中心、弦长约 130px，够）。
 *
 * ⚠⚠ **17 是量小了**（2026-08-07 三行逐行实测后改成 20）：
 *   这三行在 dy = −8 / −1.5 / +5，**恰好是毂最宽的地方**，
 *   实测半弦 67.5 / 68.0 / 67.8 → 一行放得下 135px ≈ 21.4 单位。
 *   17 只用掉 107px，白扔了四分之一的宽度 ——
 *   于是 Take Cover 的要求明明画得下，却先被挤成了三行加省略号。
 *   于是改成 20（≈126px）。
 *
 * ★ **当前值 18**：字号 7.5→8.5px 之后每单位涨到 7.15px，
 *   18 单位 ≈ 129px，与上一版占的宽度一样 —— 变的是字大了，不是行短了。
 */
/* ⛔ HUB_DETAIL_UNITS 已删：毂里不再画说明区（Nous 2026-08-08）。 */
/**
 * 扇区标签的断行预算（Nous 2026-08-07："这个可以裁切成两行"）。
 *
 * ⚠ 原来标签是**一整行不断行**的，长名字直接被扇区切掉
 *   （截图实证："Reactive Strike" → "Reactive Str…"）。
 *   我第一版的修法是"全兜底成一个图标"，Nous 否掉了 ——
 *   一圈长得一模一样等于没有图标，**信息还不如被切掉的文字多**。
 *
 * ★ 单位同样是显示宽度（拉丁 0.5、CJK 1）。标签字号 8px，实测约 7.2px/单位，
 *   7 单位 ≈ 50px，正好是一格扇区放得下的宽度。
 *
 * ★ **当前值 6**：字号 8→9px 之后每单位 8.1px，6 单位 ≈ 49px（原来 50px）。
 *   ⚠ 比 50px 窄了一点 —— 一格扇区的宽度是几何定的、不随字号变，
 *     字大了就只能少放几个字。这是**取舍不是失误**：Nous 要的是看得清。
 */
const SECTOR_LABEL_UNITS = 7;
/** 标签两行之间的行距。 */
const LABEL_LH = 9;
/** 标签最多两行 —— 三行会顶到相邻扇区，也顶到底下的记号。 */
const MAX_LABEL_LINES = 2;
/**
 * 三态的**警示记号**（Nous 2026-08-07 定："置灰 + 条件说明 + 警告 emoji"）。
 *
 * ★ 它与 `badge` 是**两件事**：badge 说"这东西是什么"（⟳ 反应、◆ 拔刀），
 *   这里说"**点下去会怎样**"。所以两者并排画，不互相顶掉。
 * ⚠ `normal` 一律空字符串 —— 绝大多数格子都是 normal，
 *   给它一个记号等于给所有格子加噪音。
 */
const STATE_MARK: Record<string, string> = { normal: "", risky: "⚠", gated: "⛔" };
/** 补充信息最多画几行 —— 再多会把毂里其它几行挤下去。 */
/* ⛔ MAX_HUB_DETAIL_LINES 已删：同上。 */
/**
 * 状态行的断行预算。
 *
 * ⚠ **单位是显示宽度不是字符数**（`text.ts` 的 charWidth：拉丁 0.5、CJK 1）——
 *   曾经有个叫 `HUB_CHARS_PER_LINE = 16` 的常量骗过我一次：31 个拉丁字符只有 15.5 单位，
 *   所以那条明明很长的状态行**根本没触发断行**，不溢出纯属字号小碰上了。
 *
 * ⚠⚠ **21 也偏大**（2026-08-07 截图后逐行量的，改成 19）：
 *   毂半径 68，但状态行不在圆心上 —— 第二行在 dy=26 处，**弦长只有 125.6px**。
 *   实测那一行 22 单位 = 127.2px，**顶出去 1.6px**。
 *   量的时候要量**那一行所在高度的弦长**，不是毂的直径 ——
 *   拿直径当预算，越往下的行越会溢出，而且只溢出一点点，看着像"字体渲染问题"。
 *   19 单位 ≈ 110px，最窄那行（dy=34，弦长 117.8）也还留得下边。
 *
 * ★ **当前值 16**：字号 6.4→7.4px 之后每单位 6.22px，16 单位 ≈ 100px。
 *   最窄那行现在在 dy=+41.6（弦长 108px）—— 仍有 8px 余量。
 */
const HUB_STATE_UNITS = 16;
/**
 * 标题两侧各留多少 px 不用（**别顶着弦长画**）。
 * 弦是曲的，正好画到弦上时视觉上已经贴边了。
 */
const HUB_TITLE_MARGIN = 10;
/**
 * 长名字最多缩到原字号的几成。
 *
 * ⚠ 有下限才有意义：一路缩下去总能塞进一行，代价是**小到读不出来** ——
 *   那等于把"看得清"换成了"不换行"，两头都不落好。缩到底还放不下就断两行。
 * ★ 0.82 是 Nous 的观感线（看到 0.78 那一版："这应该就很小了"）。
 */
const HUB_TITLE_MIN_SCALE = 0.82;
/** 标题基准字号，与 CSS 里 `.pauih-hub-title` 一致。⚠ 改一处要改两处。 */
const HUB_TITLE_PX = 11.5;
/** 标题第二行的行距（按缩后的字号算） */
const HUB_TITLE_LH_RATIO = 0.95;

/*
 * ===== 中心毂的垂直节奏（2026-08-05 重排）=====
 *
 * ⚠ 上一版让职业状态行"从经济行往上凑"（`CY+20+(i-len)*6.5`），
 *   一行时算出来是 CY+13.5，正好压在 MAP 读数的 CY+16 上 —— Nous 截图里
 *   `✦ Focus 1/1` 和 `◆ +14` 叠成一团就是这么来的。
 *
 * ★ 改成**每一行各有固定槽位**，自上而下四段，互不挤占：
 *     标题块（层名 / 悬停项名 + 断行的原因）—— 块中心固定，内容多时向两侧长
 *     MAP 读数 或 页码 —— 二选一，永不同时出现（见 #arrowMode）
 *     状态 —— **逐条一行**（2026-08-05 修：原来强拼成一行，三条就顶出毂外）
 *     动作经济 —— 固定在最下
 *
 *   槽位固定的代价是没内容时留白，好处是**有内容时永远不会打架**，
 *   而且各行位置不随内容跳动。
 */
/*
 * ★ 2026-08-05 重排：原来五行全挤在 CY-4 ~ CY+38 之间，状态只能强拼成一行，
 *   三条状态就横着顶出毂外（实机截图）。**毂半径 68，竖向本来就够** ——
 *   挤是我自己造成的，不是空间不够。
 *
 * ⚠ 每行的**可用宽度随 y 变**（圆的弦长）：`2*sqrt(R_HUB² - y²)`。
 *   越靠下越窄 —— 所以状态行放在中下部、经济行最下，是有余量的排法。
 *   在 y=+31 处半宽 60，一行 16 字放得下；y=+42 处半宽 53，只放几个记号，够。
 */
/*
 * ★★ **毂里的每一行都钉死在自己的高度上**（Nous 2026-08-07 指出的设计错误）：
 *
 *   > "nous 部分是字形在这个中间位置，然后目录名 strike 上移了为了下面有小字，
 *   >  然后进入之后 falaise 又下移了给目录让位 —— 这是 ui 设计错误，
 *   >  就是不停闪烁变动位置丢失一致性。"
 *   > "解释器应该属于附着于一个不变的 element 上。"
 *
 *   原来的做法是把「名字+说明」当成**一个块居中** —— 块高一变，名字就整体位移。
 *   于是同一个东西在三种状态下待在三个高度，眼睛每次都要重新找。
 *
 * ★ 正确的模型：**名字是锚，永远在 `HUB_TITLE_Y`**；
 *   父层小灰字挂在它上面固定一行，说明文字挂在它下面固定几行。
 *   有就画、没有就空着 —— **空着也不许把别人拉过来**。
 *
 * ⚠ 每行的可用宽度随 y 变（圆的弦长 `2*sqrt(R_HUB² - dy²)`）：越靠下越窄。
 *   所以名字放中上、状态放中下、经济行最下。
 */
/*
 * ★★ **整块上提 8**（Nous 2026-08-08："别去挤，把整个标题往上提一点点"）。
 *
 *   起因是毂里排不下第 5 行（琥珀色状态行被数值挤掉）。我的第一反应是缩字号，
 *   被他当场否掉 —— **缺的是位置不是字号**：毂顶（CY−68）到父层（CY−30）
 *   之间本来就空着 38 单位，一行没画。缩字号是拿可读性去换一块**不用换的**空间。
 *   ⇒ 父层 −30→−38、名字 −20→−28，下面整条内容栅格跟着上移 8，多出正好一行位。
 *
 * ⚠ 上提要看**弦长**（毂是圆的，越往上越窄）：名字那一行 dy 从 −20 变 −28，
 *   弦长 130→124，窄了 6 —— 长名字可能多断一行，但 `#画标题` 是按 y 现算弦长的，
 *   会自己收敛，不会顶出去。
 * ⚠ 再往上就不行了：父层这一行 dy=−38 时弦长只剩 112.8。
 */
/** 父层小灰字（悬停时才有；没有也不影响下面任何一行） */
const HUB_PARENT_Y = CY - 38;
/** ★ **锚**：名字/层名永远画在这里，不随内容多少上下动 */
const HUB_TITLE_Y = CY - 28;
/*
 * ⚠⚠ **说明区的可点金框会往外长半圈** —— 排行位时要把它算进去（2026-08-07 Nous 截图）：
 *   框的上沿 = 第一行 bbox 顶 − 留白，下沿 = 末行 bbox 底 + 留白。
 *   只按"文字在哪一行"排，框就会**压到上面的标题、顶到下面的 MAP 读数**上，
 *   而单看没有框的那些格子一切正常 —— 这类错只在有框的那一格才现形。
 * ★ 所以这一段与 HUB_TITLE_Y / HUB_VARIANT_Y 的间距是按**框的边界**留的，不是按文字。
 */
/** 说明文字第一行；往下每行 +HUB_DETAIL_LH */
/* ⛔ HUB_DETAIL_Y / HUB_DETAIL_LH 已删：说明区拿掉了，标题下面直接是环名那一行。 */
/*
 * MAP 读数 / 环名。
 *
 * ⚠⚠ **2026-08-08 从 CY+22 提到 CY−2**：说明区拿掉之后，标题下面空出一大片，
 *   而这一行还留在原处 —— 正好压在法术位点阵的上半截（点占 CY+16~+30）。
 *   ★ 病根不是"这一行放错了"，是**拿掉一块之后没有重排剩下的**：
 *     固定行位的好处是各行互不挤占，代价是**删掉一行不会自动补位**，
 *     必须手动把下面的提上来。删东西和加东西一样要走一遍整块布局。
 */
/*
 * ===== 毂内容行：**一套等距栅格**（2026-08-08 重排）=====
 *
 * ★★ Nous 的判词：
 *   > "我觉得你这问题还是在打补丁。这个明明就可以按形式整齐的排……
 *   >  spell 之外的页面就按类型写行，保持一致性就好，每行间距相同不会乱飞
 *   >  （现在就是参差不齐的）都有位置可以放。"
 *
 * ★ 病根：原来六个行位是**各自拍的**（CY−30 / −20 / −2 / +12 / +29.5 / +53），
 *   间距 10 / 18 / 14 / 17.5 / 23.5 —— 根本没有栅格。
 *   于是每加一种信息就得重算一次邻居，**加一次补一次**，
 *   而名字一断两行就直接撞上 MAP 行（实测重叠 4 单位）。
 * ⇒ 改成：名字块**固定占两行的位置**（与实际几行无关），其下所有内容行**等距依次排**。
 *   谁先画谁占前面的行位，**不留空洞、也不会互相顶**。
 *
 * ⚠ **法术层的点阵不进这套栅格**（Nous：「不用担心那个 spell 的部分，
 *   因为 strike 和 spell 页面不会同时出现」）—— 它有自己的一套 SLOT_* 常量。
 */
/**
 * 第一内容行。★ 名字固定按两行留位（上提后第二行底约 CY−13），这里再往下 7。
 * ⚠ 跟着标题块一起上移了 8（见上面那段）——**多出来的一行位就是这么来的**。
 */
const HUB_ROW_Y = CY - 6;
/**
 * 行距。⚠ 取**最高的那一行**的行高：`.pauih-hub-detail` 8px 实测行高 10（+1 间隙）。
 *   按最矮的那种（6.9px 状态行）定会让数值行叠在一起 —— 2026-08-08 就这么叠过一次。
 */
const HUB_ROW_LH = 11;
/**
 * 一共几行。
 *
 * ★★ **从 4 提到 5 是为了让琥珀色状态行留得住**（Nous 2026-08-08）：
 *   > "我看到是有空间去保存琥珀色小字的，因为现在做成保持显示最后动作，很难回去看。"
 *   毂是**停留式**的（离开扇区不清空），所以状态行一旦被这一格的数值挤掉，
 *   玩家要看它就得再去悬停一个"没有数值的格子" —— 那正是"回不去"。
 *
 * ⚠ 空间由**毂自己的圆**兜底（动作经济行已搬到顶上，底部不再有硬邻居）：
 *   CY−6 起、行距 11 ⇒ 6 行落在 94/105/116/127/138/149，
 *   末行 dy=+49，那一带弦长 2√(68²−49²) ≈ 94.6 —— 放得下一行小字 ✓；
 *   **第 7 行（160，dy=+60）弦长只剩 64，塞不下了**。
 */
const MAX_HUB_ROWS = 6;
/**
 * 给全局状态行**保底**几行。
 *
 * ★ 这一条就是上面那句话的落地：不保底的话，一个带伤害+弹药的武器格
 *   会把 5 个行位占掉 3 个（页码/MAP + 伤害 + 弹药），状态行只剩 2 行；
 *   再多一条数值，它就整块消失了。⇒ **先扣下 2 行再排数值**。
 * ⚠ 只保底不独占：状态行本来就不足 2 条时，剩下的行位还给数值行，不留空洞。
 */
const HUB_STATE_RESERVED = 2;
/**
 * 内容行的断行预算（单位同 `text.ts`）。
 * ⚠ 按**这一带最低那一行**算弦长（第 6 条：同一把尺子会往两个方向错）：
 *   末行 dy≈35 ⇒ 弦长 = 2√(68²−35²) ≈ 116px；`.pauih-hub-detail` 8px、
 *   每单位约 4.4px ⇒ 约 26 单位。取 20 留余量
 *   （`◈ Sling Bullets ×1` 才 9.5 单位，够用得很）。
 */
const HUB_NOTE_UNITS = 20;
/**
 * 动作经济行（三个 ◆ + 反应 ⟳ + 红色 « 撤回）—— **搬到毂顶，父层之上**。
 *
 * ★ Nous 2026-08-08："那个三个动作的框……这三个动作就放在顶上吧，strike 的上面。"
 * ★★ 顺带解决了另一件事：它原来钉在毂底 CY+53，把内容行卡死在 5 行，
 *   第 6 行会被剪掉（他截图里 `Enfeebled ✦ 2` 就是这么没的）。
 *   搬到顶上之后底部整段空出来 ⇒ 内容行从 5 增到 **6**。
 *   ⇒ **腾位置比缩字号划算**，这是同一天的第二例（第一例见 `.pauih-hub-detail` 的注释）。
 *
 * ⚠ 顶上的弦长比底下窄：dy=−50 时弦长 92.2 —— 这一行最宽也就 4 个记号加撤回（约 40），够用。
 * ⚠ **战斗外仍然不画**（`#paintEconomy` 里 `if (!econ) return`）：
 *   没有回合就没有"本回合还剩几个动作"，画出来是假信息。
 *   ★ Nous 说"不知道什么时候被完全删除了" —— 多半就是在战斗外看的。这条要不要改归他。
 */
const HUB_ECONOMY_Y = CY - 50;

/* ===== 法术位点阵图（Nous 2026-08-08）=====
 *
 * 一列一环、一点一位；用掉的**留在原地变灰**。
 * ⚠ 最多画 4 行，再多就在顶上加一个 `^`（他的原话）——
 *   高环施法者一环能有 5-6 个位，全画会把点阵撑到毂外。
 */
/*
 * 最下面那一行点的 y；往上每行 −SLOT_ROW。
 * ⚠ 上边界要给环名那一行让开：点最高画到 `SLOT_BOTTOM_Y − 3×SLOT_ROW`（约 CY+16），
 *   环名在 CY−2，中间留得下。改任一个都要重算这段间距。
 */
const SLOT_BOTTOM_Y = CY + 30;
const SLOT_ROW = 4.6;
/** 列间距 */
const SLOT_COL = 8;
/** 点半径 */
const SLOT_R = 1.7;
/**
 * 用掉的点画多大（相对 `SLOT_R`）。
 *
 * ★ 起因（2026-08-08）：原来"还剩 / 用掉"只差 `fill` 与 `opacity` ——
 *   实心 1.7 对上一圈 0.5 宽、再乘 0.5 透明的描边。盘实际渲染约 2.4×，
 *   落地就是**实心 4px 对上 0.6px 的灰边**，我自己看截图时把
 *   `●●●○ / ●○○○ / ○○○` 整片读成了"全空心"，据此差点报了个假问题。
 *   ★ 正是 playbook 12.5：**两个状态只差一个小记号 = 读成同一个状态**，
 *     判据是"不并排放也认得出吗" —— 玩家永远只看得到当下这一份。
 * ⚠ 修法是加**第二重**区分（大小），不是把颜色调亮：
 *   颜色在不同场景底图上不可靠，尺寸差在哪都成立。
 * ⚠ 圆心不动 —— "用掉的留在原地"是 Nous 定的形态，动的只有半径。
 */
const SLOT_SPENT_R = 0.6;
/** 一列最多画几个点 */
const SLOT_MAX_ROWS = 4;
/** `spell slots` 那行小字 */
const SLOT_LABEL_Y = CY + 38;

/**
 * 底部导航胶囊 —— **它就是一段带端帽的分段弧**，和外环同构。
 *
 * ★ 2026-08-05 第三轮（Nous：「可不可以用外圆弧度去掰弯这个胶囊」）：
 *   从横排圆角条改成弧形，跟着外环的弧度走。改完之后它与外环共用同一套
 *   `sectorArc` / `ringCapPath` / `capOvershoot`，**一个新函数都没写** ——
 *   唯一的新东西是 RingSpec 的 `center`（整段弧的中心指向正下方）。
 *
 *   顺带把几何也简化了：矩形版要先算「上边角对圆心的张角」才知道缺口开多大；
 *   弧形版全是角度加法。四个矩形量（宽 / 顶边 y / 圆角 / 肩留白）换成两个角度量。
 *
 *   ⚠ 当初放弃弧形的理由写的是「弧形要拟合极坐标去还原一个只能目测的形状，
 *     连着三版比例都没对上」—— 挡路的是**目测**，不是弧形。现在不目测了。
 */
/**
 * 扇区之间的缝（弧度）。**整个盘面只有这一个缝隙尺度** ——
 * 环与胶囊之间也用它，视觉节奏才连得上（见 GAP_ANGLE 的推导）。
 */
const SECTOR_GAP = 0.02;

/**
 * 胶囊厚度（径向）。
 *
 * ★ 2026-08-05 由 23 改为 `2 * W` —— 与环**等宽**。
 *   原来窄 4（内缘 75 vs 73、外缘 98 vs 100），加上角向的缝偏大，
 *   胶囊看着是"飘在缺口里的另一个物件"而不是环上切下来的一段（Nous 指出）。
 *   等宽之后内外缘完全对齐，接缝只剩角向那一处。
 */
const CAP_H = 2 * W;
const W_CAP = CAP_H / 2;                   // 胶囊的"笔半径"
/**
 * 胶囊三格的相对宽度，顺序同 `cells`（**反的**：next / back / prev）。
 *
 * ★ Nous 2026-08-07："左右键的宽度太大了，应该加大返回键的大小。"
 *   返回是**每一层都要用**的那一个；箭头只在能翻的层里有意义，
 *   却和它一样宽 —— 宽度该跟着使用频率走。
 */
const CAP_WEIGHTS = [1, 2.2, 1];
const CAP_SEAM = 1.6;                      // 格与格之间的缝（弧长），露底作分隔
/** 胶囊墨迹一共跨多少角（**含**它自己两端的圆头） */
const CAP_INK = (56 * Math.PI) / 180;

/**
 * 环端帽往外凸多少（1 = 满半圆，小于 1 沿切向收扁）。
 * 这个旋钮管的是端头胖瘦，与缝隙是两个维度，需要时再调。
 */
const CAP_BULGE = 1;

/**
 * 环底缺口的张角。
 *
 * ★★ **解出来的，不是估的**（2026-08-05 重推，claude-draws 的规矩）。
 *
 *   上一版写的是 `CAP_INK + 2*CAP_CLEAR + 2*capOvershoot(...)`，把 `CAP_CLEAR`
 *   当成"墨迹之间的留白"来填。但那两者不是一回事 —— 实测量出来墨迹缝隙是
 *   **5.1°**，而 `CAP_CLEAR` 填的是 4°，且扇区之间的缝只有 1.15°，
 *   三个数对不上，胶囊于是看着没接上。
 *
 *   差值来自两处**被漏掉的收缩**：扇区首尾各让出 `SECTOR_GAP/2`，
 *   胶囊首尾也各让出自己那份缝的一半。把它们算进去，反解出缺口该多大：
 *
 *     环墨迹末端（距正下方） = GAP_ANGLE/2 + SECTOR_GAP/2 − capOvershoot(R, W)
 *     胶囊墨迹边界（距正下方） = CAP_INK/2 − capGapHalf
 *     令两者之差 = SECTOR_GAP（与扇区之间同一个缝）
 *
 *   ⚠ 端帽那一项仍然不能漏：圆头在笔心之外还要凸 `asin(W/R)`，每端一份。
 *     漏掉它圆头会侵进缺口压住胶囊 —— 那是更早修掉的原始 bug，别退回去。
 */
const CAP_GAP_HALF = (CAP_SEAM / R) / 2;
const GAP_ANGLE = 2 * (
    CAP_INK / 2 - CAP_GAP_HALF          // 胶囊墨迹占的半角
    + SECTOR_GAP                        // 要留的缝，与扇区之间一致
    + capOvershoot(R, W, CAP_BULGE)     // 环端帽多占的
    - SECTOR_GAP / 2                    // 扇区首尾自己让出的那半个缝
);
/** 扇区实际占的弧长 */
const ARC_SPAN = Math.PI * 2 - GAP_ANGLE;

/**
 * 多久没动就自动收起（毫秒）。Nous 2026-08-05：晾着不动会挡视野。
 * 任何交互都会重新计时；执行动作后本来就会关，所以这条只对"呼出了又不用"生效。
 */
/*
 * ⛔ **无操作自动收起已经去掉**（Nous 2026-08-08："5 秒那个直接去掉好了"）。
 *
 * ★ 它和刚拆掉的"点盘外关闭"是**同一类问题**：
 *   你什么都没做，状态就没了 —— 而这个盘是有状态的
 *   （下钻两层、翻到第 3 环、编排走到一半）。
 *   读一段说明就能超时，代价是从头再来。
 * ⚠ 留着这个常量当墓碑：下次想加"自动收起"之前，先想清楚它会吃掉什么。
 */
// （常量已删；这段注释是墓碑，别再加回来）

/** 把 v 夹在 [lo, hi] 内。窗口比轮盘还小时以 lo 为准（hi 会小于 lo）。 */
function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(v, hi));
}

export class WheelApp extends AppV2 {
    static DEFAULT_OPTIONS = {
        id: "player-action-ui-hub-wheel",
        classes: ["pauih-wheel"],
        window: { frame: false, positioned: true },
        position: { width: SIZE, height: SIZE },
    };

    /** 当前层 */
    private level: WheelLevel;
    /**
     * 现在还停在**最外那一层**（分类层）吗。
     *
     * ★ 判据是 `canGoBack === false` —— **只有分类层没有上一层**，
     *   这不是巧合而是定义。拿标题去比对（`title === actor.name`）会在
     *   换身体、改名字时静默失效。
     * ★ 用途：卡上那份清单异步回来之后要不要重建分类层
     *   （已经下钻了就不该把人踢回外层）。
     */
    get atRoot(): boolean { return this.level.canGoBack === false; }
    /**
     * 点击扇区的回调，由外部注入。
     * ⚠ 第二个参数是**真实的 MouseEvent**，不是合成的：掷骰时要原样传给
     *   pf2e 的 `variant.roll({ event })`，生态里的模组（PF2e Toolbelt 自动掩护等）
     *   靠它拿检定上下文（设计定档 §6.3）。
     */
    private onPick: (sector: SectorData, ev: MouseEvent) => void;
    /*
     * ⛔ **「点盘外关闭」已经拆掉**（Nous 2026-08-08）：
     *   > "点击其他地方会关掉 ui 重置不是好设计，一旦误触就会重置不好，
     *   >  手抖全家爆炸。还是单独留 esc 退出 ui 最好。"
     *
     * ★ 病根：这个盘是**有状态**的 —— 下钻了两层、翻到第 3 环、
     *   编排走到第二步。一次落在盘外的点击把这些全清了，
     *   而**"点空白处"恰恰是没点中扇区时最容易发生的那一下**：
     *   手抖的代价从"这次没点着"升级成"从头再来"。
     * ★ 关闭的路留了三条，每一条都是**明确要关**的动作：Esc、返回键退到底、执行完自动关。
     */
    /** Esc 关闭用的监听器（Foundry 不管无框窗，见 openAt 注释），记着以便解绑 */
    private escHandler?: (ev: KeyboardEvent) => void;

    constructor(
        level: WheelLevel,
        onPick: (s: SectorData, ev: MouseEvent) => void,
        options: object = {},
    ) {
        super(options);
        this.level = level;
        this.onPick = onPick;
    }

    /**
     * 重算当前层的回调，由外部注入；**没有它就不会自动刷新**。
     * 返回 null 表示这一层已经无内容可显示（例如角色的打击全没了）→ 关盘。
     */
    rebuild?: () => WheelLevel | null;

    /** refresh 的合并闸，见 refresh() 的注释 */
    #refreshQueued = false;

    /**
     * 取动作经济现状的回调，由外部注入。
     * **不在战斗中要返回 null** —— 战斗外没有"回合"，画 ◆◆◇ 是假信息。
     */
    economy?: () => {
        remaining: number;
        /**
         * 本回合**一共**几个动作。省略按基准 3。
         * ★ 迅捷 4、缓慢 1 时 2 —— 格子数要跟着变，
         *   画三个格子却只有两个能用，等于把状态藏进了数字里。
         */
        total?: number;
        /** 为什么不是 3（"Slowed 1" / "Quickened"）；给毂里显示用 */
        notes?: string[];
        canUndo: boolean;
        /** 本轮还剩几个反应；省略表示不画反应记号 */
        reactionsLeft?: number;
    } | null;

    /** 点了撤回时调用，由外部注入（真正的记账退还在外面做）。 */
    onUndo?: () => void;
    /**
     * 点毂里那几行说明 → 打开这个 uuid 的说明窗。由外部注入（这一层不碰 Foundry 的文档 API）。
     * ⚠ 与 `onPick` 分开：**看说明不等于执行**（合成一个会让人不敢点）。
     */
    onInfo?: (uuid: string) => void;

    /**
     * 取职业状态行的回调，由外部注入。返回空数组 = 这一格不出现。
     * ⚠ 与 economy 不同，它**不受"在不在战斗中"限制** ——
     *   专注点余量在战斗外一样有意义。
     */
    classState?: () => string[];

    /** 无操作自动收起的计时器 */

    /** 换一层内容并重绘（钻取与双向绑定都走这里） */
    async setLevel(level: WheelLevel): Promise<void> {
        this.level = level;
        // ⚠ 换层时旧提示指着的元素马上就要被换掉 —— 先关
        this.#全名 = null;
        this.#全名提示(null);
        // ⚠ 换层要**忘掉上一层悬停过哪一格** —— 毂现在是"停留式"的（见 #onHover），
        //   不清的话新层第一眼显示的是上一层某一格的说明，而下标还恰好对得上。
        this.#hoveredIndex = null;
        await this.render(false);
    }

    /**
     * 角色数据变了：重算当前层并重绘。轮盘＝角色卡的另一个实时视图，
     * 靠这个方法兑现。
     *
     * ⚠ **必须合并**：一次拔刀会连着放出好几个文档钩子
     * （物品的 equipped 变了 → updateItem，派生数据重算 → updateActor），
     * 每个都直接 render 会在同一帧里重绘好几次，白闪且互相抢。
     * 这里推迟到下一个宏任务再做，把这一串合成一次。
     *
     * 层结构不变时保留翻选条的下标——玩家翻到第 2 击，不该因为拔了把刀就跳回第 1 击。
     *
     * ⚠⚠ **翻页位置同理，而且原来漏了**（2026-08-08 修）：上面这句意图只对 `variant`
     *   实现过，`paging` 没带 —— 而每个 `rebuild` 返回的都是 `page: 0`。
     *   于是在 1 环页点一下休息，盘就弹回戏法页；戏法页上没有环 badge，
     *   看起来像"数据没刷新"。★ **位置丢失会伪装成数据不更新**，
     *   查的时候差点顺着"双向绑定坏了"往下挖（那条链实测是好的）。
     *   带法见 `carryPage`：有分组时按**环标签**找回，不按下标。
     */
    async refresh(): Promise<void> {
        if (!this.rebuild || this.#refreshQueued) return;
        this.#refreshQueued = true;
        await new Promise((resolve) => setTimeout(resolve, 0));
        this.#refreshQueued = false;

        // 等这一帧的工夫里可能已经关盘/回到上一层了
        if (!this.rendered || !this.rebuild) return;

        const next = this.rebuild();
        if (!next) { await this.close(); return; }
        if (this.level.variant && next.variant) next.variant.index = this.level.variant.index;
        if (next.paging) {
            const 新页数 = next.paging.groups?.length || pageCount(next.sectors.length);
            next.paging.page = carryPage(this.level.paging, next.paging, 新页数);
        }
        await this.setLevel(next);
    }

    // ⚠ 计划原文写的返回类型是 Promise<HTMLElement>，tsc 报 TS2740：
    //   SVGSVGElement 不是 HTMLElement。这里按实际产物改成 SVGElement。
    //   AppV2 对 _renderHTML 的返回值不限类型，它只是原样传给 _replaceHTML。
    async _renderHTML(): Promise<SVGElement> {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("viewBox", `0 0 ${VIEW} ${VIEW}`);
        svg.setAttribute("class", "pauih-svg");

        /*
         * ★ **几何位置与数据下标是两回事**，这里必须分开：
         *   - `pos`   = 这一格在**当前页**里排第几，几何（角度、端帽）用它；
         *   - `index` = 它在 `level.sectors` **全量**里的下标，`data-index` 存它。
         *
         *   混用会静默错位：第 2 页第 1 格的 pos 是 0，若把 0 写进 data-index，
         *   点它执行的就是第 1 页的第 1 个。分派逻辑读的是 data-index，
         *   所以这么分开之后 `#onClick`／`#onHover` 一行都不用改。
         */
        const visible = this.#visibleSectors();
        const total = visible.length;
        const ring = { cx: CX, cy: CY, R, W, total, gap: SECTOR_GAP, arcSpan: ARC_SPAN };

        visible.forEach(({ sector, index }, pos) => {
            /*
             * 一个扇区 = 一段描边弧。整组包在 <g> 里，是为了让**首尾扇区的圆头端帽**
             * 跟着本扇区一起 hover／变色 —— 端帽是独立元素，靠 group hover 联动。
             */
            const group = document.createElementNS(SVG_NS, "g");
            /* ★ 状态也挂在组上：risky 的发光要**包住整条扇区连同端帽的外轮廓**。
               挂在各自元素上的话，两者的接缝处会各自描一圈，内部冒出发光边。 */
            const group_cls = `pauih-sector-g state-${sector.state}`;
            group.setAttribute("class", group_cls);

            const draw = sectorArc(ring, pos);
            const spin = document.createElementNS(SVG_NS, "g");
            spin.setAttribute("transform", `rotate(${draw.rotate} ${CX} ${CY})`);

            const arc = document.createElementNS(SVG_NS, "circle");
            arc.setAttribute("cx", String(CX));
            arc.setAttribute("cy", String(CY));
            arc.setAttribute("r", String(R));
            arc.setAttribute("stroke-width", String(draw.strokeWidth));
            arc.setAttribute("stroke-dasharray", draw.dash);
            // 三态各有自己的 class：risky 不变暗，只加琥珀标记（设计定档 §6.4）
            arc.setAttribute("class", `pauih-sector state-${sector.state}`);
            arc.dataset.index = String(index);
            spin.appendChild(arc);
            group.appendChild(spin);

            /*
             * 环的最外两端补圆头。扇区一律 butt（相邻圆头会各凸出 asin(W/R)，
             * 把缝隙吃掉粘成一片），只有首尾这两处该是圆的。
             *
             * ⚠ 补的是**半圆**不是整圆：底色半透明（--background 自带 0.9 alpha），
             *   整圆有一半压在弧上，两层叠加会更深，端帽上浮出一道弧形接缝。
             */
            // 端帽只补在**这一页**的首尾两格上（用 pos，不是全量下标）
            // ⚠ 一页只有一格时首尾是同一格，两个帽子都要补 —— 见 capsFor
            for (const which of capsFor(pos, total)) {
                const cap = document.createElementNS(SVG_NS, "path");
                cap.setAttribute("d", ringCapPath(ring, which, CAP_BULGE));
                cap.setAttribute("class", `pauih-sector-cap state-${sector.state}`);
                cap.dataset.index = String(index);
                group.appendChild(cap);
            }

            svg.appendChild(group);

            const c = sectorCentroid(ring, pos);

            if (sector.img) {
                // ★ 有图标就**只画图标**：名字交给中心毂在悬停时显示，
                //   长名字因此不可能压出扇区（见 types.ts 的 img 注释）。
                const size = 18;
                const img = document.createElementNS(SVG_NS, "image");
                img.setAttribute("href", sector.img);
                img.setAttribute("x", String(c.x - size / 2));
                img.setAttribute("y", String(c.y - size / 2 - (sector.badge ? 3 : 0)));
                img.setAttribute("width", String(size));
                img.setAttribute("height", String(size));
                img.setAttribute("class", `pauih-icon state-${sector.state}`);
                img.dataset.index = String(index);
                svg.appendChild(img);
            } else {
                /*
                 * ★ **标签断成最多两行**（Nous 2026-08-07）。
                 * ⚠ SVG 的 <text> 不会自动换行 —— 断行必须自己做成 <tspan>，
                 *   不做的话长名字就被扇区边缘切掉，而且**不报错**。
                 * ⚠ 两行仍放不下才收省略号：让玩家知道"还有下文"，
                 *   比无声截断强（名字全文在毂里，悬停就看得见）。
                 */
                const 全部 = wrapText(sector.label, SECTOR_LABEL_UNITS);
                const 行 = 全部.slice(0, MAX_LABEL_LINES);
                if (全部.length > MAX_LABEL_LINES && 行.length) 行[行.length - 1] += "…";
                const text = document.createElementNS(SVG_NS, "text");
                text.setAttribute("x", String(c.x));
                // 多一行就整体上提半行，让这一格的文字块仍以扇区中心为中心
                text.setAttribute("y", String(c.y - (行.length - 1) * LABEL_LH / 2));
                // ★ 状态直接挂在 label 上，不靠 CSS 兄弟选择器。
                //   扇区包进 <g> 之后 `.pauih-sector ~ .pauih-label` 的兄弟关系就断了，
                //   那种写法会**静默失效**（灰显不再变色，且没有任何报错）。
                // ★ `tone` 是**第二根轴**："点了是哪一类事"，与三态的"能不能点"不同轴，
                //   所以两个 class 并存，不是二选一（见 types.ts 的 tone 注释）。
                text.setAttribute("class",
                    `pauih-label state-${sector.state}${sector.tone ? ` tone-${sector.tone}` : ""}`);
                text.dataset.index = String(index);
                 行.forEach((l, i) => {
                    const span = document.createElementNS(SVG_NS, "tspan");
                    span.setAttribute("x", String(c.x));
                    if (i > 0) span.setAttribute("dy", String(LABEL_LH));
                    span.textContent = l;
                    text.appendChild(span);
                });
                svg.appendChild(text);
            }

            /*
             * ★ **警示记号自成一个元素**（Nous 2026-08-07："置灰 + 条件说明警告 emoji"）。
             *
             * ⚠ 第一版把它拼进 `badge` 里，结果**画出来等于没画**：
             *   badge 是 5px 的小字，emoji 在深色环上那个尺寸根本认不出
             *   （实测 bbox 宽 6.9px、填充色还是灰的）。
             *   它要答的是"点下去会怎样"，是**最该一眼看见**的一条，不能跟小字挤一起。
             *
             * ★ 放右上角、条目记号仍在正下方 —— 两者答不同的问题，各占各的位置，
             *   ⟳ 和 ⛔ 就不会互相顶掉。
             */
            const 警示 = STATE_MARK[sector.state] ?? "";
            if (警示) {
                const mark = document.createElementNS(SVG_NS, "text");
                mark.setAttribute("x", String(c.x + 9));
                mark.setAttribute("y", String(c.y - 7));
                mark.setAttribute("class", `pauih-state-mark state-${sector.state}`);
                mark.textContent = 警示;
                mark.dataset.index = String(index);
                svg.appendChild(mark);
            }

            if (sector.badge) {
                const badge = document.createElementNS(SVG_NS, "text");
                badge.setAttribute("x", String(c.x));
                badge.setAttribute("y", String(c.y + (sector.img ? 8 : 9)));
                badge.setAttribute("class", `pauih-badge state-${sector.state}`);
                badge.textContent = sector.badge;
                badge.dataset.index = String(index);
                svg.appendChild(badge);
            }
        });

        // 中心毂
        const hub = document.createElementNS(SVG_NS, "circle");
        hub.setAttribute("cx", String(CX));
        hub.setAttribute("cy", String(CY));
        hub.setAttribute("r", String(R_HUB));
        hub.setAttribute("class", "pauih-hub");
        svg.appendChild(hub);

        /*
         * ⚠ 毂与环之间那圈**什么都不画**。
         *
         *   Nous 2026-08-05：「这个白圈应该只是一个切割，而不是真的白圈。」
         *   mockup 是浅背景，那圈本来就是背景本身透出来 —— 它是**空的**，
         *   不是一个浅色的环。所以这里留空，让底下的毛玻璃／场景透上来，
         *   GUTTER 只负责把毂和环隔开。
         *   （上一版画成了 opacity .7 的亮环，方向反了。）
         */

        // 底部导航胶囊：挂在环底缺口下方，探出环外
        this.#paintCapsule(svg);

        // 中心毂文字：一个容器，内容由 #paintHub 填，悬停时重填
        const hubText = document.createElementNS(SVG_NS, "g");
        hubText.setAttribute("class", "pauih-hub-text");
        svg.appendChild(hubText);
        this.#paintHub(hubText, null);

        return svg;
    }

    /**
     * 画底部导航胶囊（照 Nous 2026-08-05 的 mockup）。
     *
     * 三格：‹ 上一项 · ↩ 返回 · › 下一项。
     * **它是通用导航条**：上面这一层是什么，‹› 就翻什么 ——
     * 打击层翻 MAP 三段，将来条目多到要分页时就翻页。
     * 没得翻时箭头置灰不可点，但格子照画，免得胶囊忽宽忽窄。
     */
    #paintCapsule(svg: SVGElement): void {
        // ⚠ 判据要跟着 #arrowMode 走，不能只看 variant ——
        //   否则动作层（有分页、无 MAP）的箭头会是灰的、点不动。
        /*
         * ⚠ 顺序是**反的**：角度从正上方顺时针增大，所以在底部一带，
         *   下标越大越靠左。要让 ‹ 出现在左边，它就得排在数组最后。
         * ★ 两个箭头**各自判**能不能走（不再共用一个 canCycle）——
         *   到头的那一边灰掉，另一边照常亮着。
         */
        const cells = [
            { action: "next", glyph: "›", enabled: this.#canStep(1) },
            { action: "back", glyph: "↩", enabled: this.level.canGoBack },
            { action: "prev", glyph: "‹", enabled: this.#canStep(-1) },
        ];

        /*
         * 胶囊 = 一段分成三格的弧，和外环同一条中线（所以贴合是几何保证的，不是调出来的）。
         * 笔心跨度要从墨迹跨度里扣掉它自己两端的圆头 —— 和外环那条约束同源。
         */
        const bar = {
            cx: CX,
            cy: CY,
            R,
            W: W_CAP,
            total: cells.length,
            gap: CAP_SEAM / R,                       // 缝按弧长给，换算成角
            arcSpan: CAP_INK - 2 * capOvershoot(R, W_CAP),
            center: Math.PI / 2,                     // 整段弧的中心指向正下方
            /*
             * ★ 返回键做宽、箭头做窄（Nous 2026-08-07）。
             * ⚠ 顺序跟着 `cells` 走 —— 那个数组是**反的**（下标越大越靠左），
             *   所以中间那个 2.2 对的是 `back`。改 cells 顺序时这里要一起改，
             *   两者对不上不会报错，只会把宽格子放到箭头上。
             */
            weights: CAP_WEIGHTS,
        };

        cells.forEach((cell, index) => {
            const group = document.createElementNS(SVG_NS, "g");
            group.setAttribute("class", `pauih-cap-g${cell.enabled ? "" : " disabled"}`);

            const draw = sectorArc(bar, index);
            const spin = document.createElementNS(SVG_NS, "g");
            spin.setAttribute("transform", `rotate(${draw.rotate} ${CX} ${CY})`);

            const arc = document.createElementNS(SVG_NS, "circle");
            arc.setAttribute("cx", String(CX));
            arc.setAttribute("cy", String(CY));
            arc.setAttribute("r", String(R));
            arc.setAttribute("stroke-width", String(draw.strokeWidth));
            arc.setAttribute("stroke-dasharray", draw.dash);
            arc.setAttribute("class", "pauih-cap");
            if (cell.enabled) arc.dataset.nav = cell.action;
            spin.appendChild(arc);
            group.appendChild(spin);

            // 两端补半圆帽（同外环：整圆会和弧身叠出更深的一块）
            // ⚠ 同外环那条：胶囊只有一格时也要补两个帽子（见 capsFor）
            for (const which of capsFor(index, cells.length)) {
                const end = document.createElementNS(SVG_NS, "path");
                end.setAttribute("d", ringCapPath(bar, which));
                end.setAttribute("class", "pauih-cap-end");
                if (cell.enabled) end.dataset.nav = cell.action;
                group.appendChild(end);
            }
            svg.appendChild(group);

            const c = sectorCentroid(bar, index);
            const t = document.createElementNS(SVG_NS, "text");
            t.setAttribute("x", String(c.x));
            t.setAttribute("y", String(c.y));
            t.setAttribute("class", `pauih-cap-glyph${cell.enabled ? "" : " disabled"}`);
            t.textContent = cell.glyph;
            svg.appendChild(t);
        });
    }

    /**
     * 重画中心毂文字。
     *
     * ⚠ SVG 的 `<text>` **没有自动换行**（不像 HTML），整句塞进去会横着冲出轮盘、
     * 盖住扇区 —— 2026-08-04 实机就是这么翻车的。必须自己断行成多个 `<tspan>`。
     *
     * @param sector 悬停中的扇区；null = 没悬停，只显示层标题
     */
    #paintHub(g: SVGGElement, sector: SectorData | null): void {
        g.replaceChildren();

        const line = (text: string, y: number, cls: string): SVGTextElement => {
            const t = document.createElementNS(SVG_NS, "text") as SVGTextElement;
            t.setAttribute("x", String(CX));
            t.setAttribute("y", String(y));
            t.setAttribute("class", cls);
            t.textContent = text;
            g.appendChild(t);
            return t;
        };

        /*
         * ★★ **固定行位**（见上面那段）：名字永远在 `HUB_TITLE_Y`，
         *   父层在它上面、说明在它下面，各自有固定的家。
         *   没悬停时说明区就是空的 —— 空着，而不是把名字拉回中间。
         */
        if (!sector) {
            // ⚠ 层标题也走同一套：角色名同样可能很长（"Construct Companion · Whirp"）
            const 层 = this.#画标题(g, this.level.title, HUB_TITLE_Y, "pauih-hub-title");
            this.#全名 = 层.truncated ? this.level.title : null;
        } else {
            /*
             * ★ 悬停时上面那行小灰字写"这一层是什么"（Nous 2026-08-07）：
             *   毂里那个大字没悬停时是**层名**、悬停时被换成**条目名** ——
             *   一悬停，"我在哪一层"就没了。而 "Pistol Wand · Reload"
             *   这种名字本身并不告诉你它属于打击层。
             * ⚠ 分类层不写：那一层的条目**就是**层，再写一遍角色名是噪音。
             */
            const 父层 = this.level.canGoBack ? this.level.title : null;
            if (父层) line(父层, HUB_PARENT_Y, "pauih-hub-parent");

            /*
             * ★ 毂里用 `hubLabel`（有就用）——环上那格放不下一句话，毂里放得下。
             *   Nous 2026-08-07："蓝色是中心圆盘上的，边盘上面就只放一个蓝色的加号。"
             */
            const 名 = sector.hubLabel ?? sector.label;
            const 标 = this.#画标题(g, 名, HUB_TITLE_Y,
                `pauih-hub-title${sector.tone ? ` tone-${sector.tone}` : ""}`, sector.infoUuid);
            // ★ 只有**真的没显示全**才挂提示 —— 名字已经在毂里了，
            //   再弹一个一模一样的黑框是把同一件事说两遍
            this.#全名 = 标.truncated ? 名 : null;

            /*
             * ⛔ **说明区整块拿掉了**（Nous 2026-08-08："现在很多东西重叠了，
             *   取消所有的细节说明，所有的标题都可以点击弹出细节"）。
             *
             * ★ 病根是**同一件事在三处各说一遍**：扇区上一个角标、毂里三行说明、
             *   点开还有一张完整卡片。三份都不全，加起来还互相挤。
             *   现在只留两层：**要用的数印在扇区上**，**要读的全文点标题看**。
             * ★ 名字本身就是那个按钮 —— 不用再教用户"哪里可以点"，
             *   他本来就在看名字。
             */
        }

        // MAP 三段的当前项，例 "◆ +9 (MAP -5)"。
        //
        // ★ **少了这一行，翻选就是完全无反馈的。** 2026-08-05 实测复现：
        //   点胶囊的 › 之后 `variant.index` 确实由 0 变成 1，但屏幕上一个像素都没变，
        //   玩家无从知道自己下一击算的是第几段 —— 而 MAP 恰恰是 PF2e 最容易算错的一处，
        //   把它显示出来正是本模组的根理（设计定档 §0）。
        //   这行原本在毂里，把翻选箭头挪进底部胶囊时被一起删掉了，是那次改版的漏网。
        //   （`.pauih-variant` 的样式当时留了下来，所以这里不需要新样式。）
        //
        // 分页层则在同一位置显示页码 —— 两者不会同时出现：
        // 箭头归谁管由 #arrowMode 决定，这里跟着它走，**读数和箭头永远说的是同一件事**。
        // （分开判断的话会出现"箭头在翻页、读数却显示 MAP"这种自相矛盾的状态。）
        /*
         * ===== 内容行游标 =====
         * 谁先画谁占前面的行位，等距往下排 —— **不留空洞，也不会互相顶**。
         * ⚠ 顺序即优先级：放不下的那些自然被截在末尾，而不是压到动作经济行上。
         */
        let 行号 = 0;
        const 下一行位 = (): number | null =>
            行号 >= MAX_HUB_ROWS ? null : HUB_ROW_Y + 行号++ * HUB_ROW_LH;
        const 画行 = (text: string, cls: string): void => {
            const y = 下一行位();
            if (y !== null) line(text, y, cls);
        };

        const mode = this.#arrowMode();
        if (mode === "page") {
            const total = this.#pageCount();
            /*
             * ★ 按组分页时写**组名**，不写页码（Nous 2026-08-08：
             *   "需要在中心圆上写明你现在看到的是第几环的法术"）。
             *   `2nd Rank ◈ 4/4` 比 `2 / 4` 多答两个问题：**哪一环**、**还剩几个位**，
             *   而后者正是"要不要用这一环"的唯一输入。
             */
            const g = this.#pageGroup();
            /*
             * ★ 有点阵图时，**环名照写、余量交给点阵** —— 两者说的不是同一件事：
             *   环名答"我在哪一页"，点阵答"各环还剩多少"。
             *   把余量留在这一行会和点阵重复（同一个数说两遍）。
             */
            const 有点阵 = !!this.level.slots?.columns.length;
            画行(g ? (有点阵 || !g.badge ? g.label : `${g.label}  ${g.badge}`)
                   : `${normalizePage(this.level.paging!.page, total) + 1} / ${total}`,
                 "pauih-variant");
        } else if (this.level.variant?.labels.length && 行号 < MAX_HUB_ROWS) {
            /*
             * ★★ **三档一起摆，当前那档高亮**（Nous 2026-08-07）：
             *
             *   > "其实是 map 的 +14、+9、+4，这里应该顺便把那个括号 map 减值写上去。"
             *
             *   原来只画当前那一档。而**第 1 击的 label 本来就没有括号**
             *   （pf2e 给的就是 `"+14"`），于是玩家在第 1 击时**根本看不到 MAP 这回事** ——
             *   他得先翻一下才知道后面要扣多少。而"翻一下才知道"正是这个模组要消灭的东西。
             *
             * ★ 摆法照角色卡：`+14 · +9 (MAP -5) · +4 (MAP -10)`，
             *   当前那档亮、其余暗。**一眼看完整个阶梯**，不必翻。
             *
             * ⚠ 分档必须用 `<tspan>` 分别上色 —— 一个 `<text>` 只能一种颜色，
             *   拿括号或星号去"标记当前档"在一串数字里根本认不出来。
             */
            const v = this.level.variant;
            // ⚠ 这一行要分档上色（tspan），走不了 `画行`，所以只跟游标要一个行位
            //   （上面的 `行号 < MAX_HUB_ROWS` 已保证拿得到）
            const t = document.createElementNS(SVG_NS, "text");
            t.setAttribute("x", String(CX));
            t.setAttribute("y", String(下一行位()!));
            t.setAttribute("class", "pauih-variant");
            v.labels.forEach((l, i) => {
                if (i > 0) {
                    const sep = document.createElementNS(SVG_NS, "tspan");
                    sep.setAttribute("class", "pauih-variant-sep");
                    sep.textContent = " · ";
                    t.appendChild(sep);
                }
                const span = document.createElementNS(SVG_NS, "tspan");
                span.setAttribute("class", i === v.index ? "pauih-variant-on" : "pauih-variant-off");
                // 只有当前那档带 ◆：三个记号并排会让人以为要花三个动作
                span.textContent = (i === v.index ? l : l.replace(/^◆\s*/, ""));
                t.appendChild(span);
            });
            g.appendChild(t);
        }

        /*
         * 职业状态区（设计定档 §7）——**只在有内容时出现**。
         *
         * ★ 这是"甲类空白"的落点：panache 有没有、专注还剩几点这类东西
         *   在 pf2e 里不是 item，列表型 HUD 结构上做不了，而毂天生是块屏。
         * ⚠ 没内容时一行都不画，且**不占位**：下面的动作经济行位置固定，
         *   所以状态行往上排，有几行画几行。
         */
        /*
         * ⚠ **逐条一行，不拼接**（2026-08-05 修）：
         *   原来用 " · " 强拼成一行，三条状态
         *   （`Focus ✦ 0/1 · Hero Points ✦ 1/3 · Dragon's Flight ✦ on`）
         *   横着顶出毂外、盖住扇区 —— SVG 的 `<text>` 不会自动换行，
         *   这正是本文件顶部那条警告说的事，我自己又踩了一次。
         *
         * ⚠ 单条过长时**照样要断行**：`Divine Spark ✦ Skin Hard as Horn` 一条就超预算。
         *   断出来的行照样占槽位，超出上限就不画 —— 宁可少显示一条，不要画到毂外面去。
         *   ⚠ 预算走 `HUB_STATE_UNITS`（量出来的），不是标题那个 16。
         */
        /*
         * ★ **点阵图与状态行共用同一片地方，二选一**：
         *   点阵占了 CY+18 ~ CY+42 那一带，正是状态行的槽位。
         * ⚠ 这不是"藏起来"：法术层里真正在用的资源**就是法术位**，
         *   而它比三行文字说得更全（各环一起给）。
         *   焦点/英雄点在别的层照旧显示。
         */
        /*
         * 悬停这一格的一行状态（弹药余量之类）。**只画一行，且要断得住**：
         * SVG 的 <text> 不换行，长了会横着冲出毂外还不报错（本文件第 4 条）。
         * ⚠ 预算按**这一行自己的高度**算弦长，不跨块沿用别处的数（第 6 条）：
         *   dy = HUB_NOTE_Y − CY = 12 → 弦长 = 2√(68²−12²) ≈ 133.9px；
         *   `.pauih-hub-detail` 8px、每单位约 4.4px ⇒ 约 30 单位，保守取 20。
         */
        /*
         * ★★ **这一格的数值顶掉全局状态区** —— 与法术层的点阵完全同构（见下面那一支）。
         *
         *   两者抢的是同一片地方（CY+12 ~ 经济行之间），而**悬停时你正在看这一格**：
         *   playbook 12.7 的分层判据是**用途** —— 这一击打多少伤害、枪里还有几发，
         *   是当下要做决定的数；Hero Points / 职业状态是背景，没悬停时才是主角。
         * ⚠ 所以这里 `return`：不是"藏起来"，是**同一块屏在两种时刻显示两件事**。
         *   没悬停、或这一格没有数值时，状态区照旧（下面那段）。
         */
        /*
         * ★★ **先给全局状态扣下位置，再排这一格的数值**。
         *   顺序上数值在前（悬停时它更相关），但**额度上状态先扣** ——
         *   否则数值一多就把琥珀色那几行整块挤没，而毂是停留式的，挤没了就回不去
         *   （Nous 2026-08-08）。
         * ⚠ 只保底不独占：状态本来就不足 `HUB_STATE_RESERVED` 条时，
         *   剩下的行位还给数值行，不留空洞。
         */
        const 状态行: string[] = [];
        for (const entry of this.classState?.() ?? []) {
            for (const l of wrapText(entry, HUB_STATE_UNITS)) 状态行.push(l);
        }
        const 数值上限 = MAX_HUB_ROWS - Math.min(状态行.length, HUB_STATE_RESERVED);

        for (const n of sector?.hubNotes ?? []) {
            // 单条过长照样断行，断出来的行也各占一个行位
            for (const l of wrapText(n, HUB_NOTE_UNITS)) {
                if (行号 >= 数值上限) break;
                画行(l, "pauih-hub-detail");
            }
            if (行号 >= 数值上限) break;
        }

        if (this.level.slots?.columns.length) {
            const cols = this.level.slots.columns;
            const 页 = this.#pageGroup();
            // ⚠ 当前列按**页标签**对，不按下标 —— 一环可能切成好几页（法术多的时候），
            //   拿页码当列号会在那种角色身上整体错位
            const current = 页 ? cols.findIndex(c => c.label === 页.label) : -1;
            this.#画点阵(g, { columns: cols, current }, this.#将花掉(cols, current, sector));
            this.#paintEconomy(g);
            return;
        }

        // 琥珀色状态行 —— 上面已经为它扣过额度，这里照排（`画行` 自己会在行位用完时停）
        for (const l of 状态行) 画行(l, "pauih-class-state");

        this.#paintEconomy(g);
    }

    /**
     * 毂底的动作经济行：三个菱形 + 一个红色 « 撤回（Nous 2026-08-05 定的形态）。
     *
     * ★ **系统不记这件事**，这是我们自己的账（见 economy.ts 顶部）；
     *   **只显示不阻止**，余额为负也照实画出来。
     * ⚠ 撤回退的是**动作点记账**，不是把骰子收回来 —— 已经进聊天栏的收不回。
     */
    #paintEconomy(g: SVGGElement): void {
        const econ = this.economy?.();
        if (!econ) return;                     // 不在战斗中：没有回合，画点数是假信息

        const y = HUB_ECONOMY_Y;
        const pipDx = 8;
        // 格子数跟着本回合实际动作数走（迅捷 4 格、缓慢 1 时 2 格）
        const pips = glyphs(econ.remaining, econ.total);
        /*
         * ★ 反应记号用**另一个字形** ⟳/⟲，不是第四个 ◆（Nous 2026-08-05 定）。
         *   反应不占常规动作，画成第四个菱形会让人以为这回合有四个动作 ——
         *   那正是"把规则简化错了"的样子。
         *   `reactionsLeft` 为 undefined 表示这个来源还没接反应池，那就整个不画。
         */
        const hasReaction = econ.reactionsLeft !== undefined;

        /*
         * ★★ **三段式：左 ⟳ ／ 中 ◆◆◆ ／ 右 «**（Nous 2026-08-08）：
         *   > "左边是反应，右边是退回，然后中间横着在中线的三个菱形。"
         *
         * ★ 关键是**菱形组自己居中于 CX**，不是"整行居中"。
         *   原来把 ⟳ 和 « 也算进总宽一起居中 —— 于是菱形被那两个记号推得偏了左，
         *   而菱形才是这一行的主角（每回合都在看的是"还剩几个动作"）。
         *   ⚠ 更坏的是那个偏移**会变**：有没有反应池、能不能撤回都改变总宽，
         *     于是菱形在不同状态下落在不同位置 —— 正是"锚在漂"（playbook 〇）。
         *   ⇒ 现在无论两侧有没有东西，菱形组的中心恒等于 CX。
         *
         * ⚠ 两侧**贴着菱形组排**而不是钉在固定 x：动作数会变（迅捷 4 格、缓慢 2 格），
         *   钉死的话 4 格时会被菱形顶到，3 格时又离得太散。
         */
        const 组半宽 = ((pips.length - 1) * pipDx) / 2;
        const 侧距 = 组半宽 + pipDx + 2;          // 与菱形组留出一整格，读作"另一个池"

        [...pips].forEach((ch, i) => {
            const t = document.createElementNS(SVG_NS, "text");
            t.setAttribute("x", String(CX - 组半宽 + i * pipDx));
            t.setAttribute("y", String(y));
            t.setAttribute("class", `pauih-pip${ch === "◆" ? " full" : ch === "✕" ? " over" : ""}`);
            t.textContent = ch;
            g.appendChild(t);
        });

        if (hasReaction) {
            const left = econ.reactionsLeft!;
            const t = document.createElementNS(SVG_NS, "text");
            t.setAttribute("x", String(CX - 侧距));      // ← 左
            t.setAttribute("y", String(y));
            t.setAttribute("class", `pauih-reaction${left > 0 ? " full" : ""}`);
            t.textContent = reactionGlyph(left);
            g.appendChild(t);
        }

        const undo = document.createElementNS(SVG_NS, "text");
        undo.setAttribute("x", String(CX + 侧距));       // → 右
        undo.setAttribute("y", String(y));
        undo.setAttribute("class", `pauih-undo${econ.canUndo ? "" : " disabled"}`);
        undo.textContent = "«";
        if (econ.canUndo) undo.dataset.nav = "undo";
        g.appendChild(undo);
    }

    /** 当前变体下标（0 = 第 1 击）；这一层没有翻选条时返回 0。 */
    currentVariantIndex(): number {
        return this.level.variant?.index ?? 0;
    }

    /**
     * 当前页要画的扇区，**带上它们在全量里的下标**。
     * 没有分页状态时就是全部（下标即位置）。
     */
    #visibleSectors(): { sector: SectorData; index: number }[] {
        const all = this.level.sectors.map((sector, index) => ({ sector, index }));
        const g = this.#pageGroup();
        // 按组分页：这一页就是那一组的下标区间（`index` 仍是全量下标，不用改分派）
        if (g) return all.slice(g.from, g.from + g.count);
        return this.level.paging ? pageOf(all, this.level.paging.page) : all;
    }

    /**
     * 悬停这一格，会吃掉当前这一环的**哪一个位** —— 返回那个点的行号；不预示时 −1。
     *
     * ★ Nous 2026-08-08 定的：
     *   > "在第二页开始的里面，悬浮于会用到那个技能槽中匹配的点开始闪烁变红，
     *   >  表示你发法术会用到。"
     *   ★ 这一条把点阵从**记账**变成**预告**：原来它答"我还剩几个"，
     *     现在还答"点下去之后会变成什么样" —— 而后者才是做决定要的。
     *
     * ⚠ **戏法页天然不预示**：`slotMatrix` 不收 cantrips，所以那一页
     *   `current` 恒为 −1（实测过）。不用另写一条"是不是戏法"的判断 ——
     *   少一个自己维护的判据，就少一处会和系统说法分叉的地方。
     *
     * 四道闸，每道都对应一种"点了其实不花位"：
     *   ① 没悬停；② 出口格（`tone: "link"`，开角色卡的那个蓝 `+`）；
     *   ③ 规则上此刻用不了（`gated`）；④ 这一环已经空了。
     * ⚠ 由下往上填，所以"下一个被吃的"是**最上面那个还亮着的**，即 `value - 1`。
     *   ⚠ 这里**不夹到画得下的行数**：夹了就会指着一个错的位，
     *     由调用处按行号是否超出去决定改点 `^`（见 `#画点阵`）。
     */
    #将花掉(
        cols: NonNullable<WheelLevel["slots"]>["columns"],
        current: number,
        sector: SectorData | null,
    ): number {
        if (!sector || current < 0) return -1;
        if (sector.tone === "link" || sector.state === "gated") return -1;
        const 剩 = cols[current]?.value ?? 0;
        return 剩 > 0 ? 剩 - 1 : -1;
    }

    /** 当前页对应的组；这一层不是按组分页时返回 null。 */
    #pageGroup(): { label: string; badge?: string; from: number; count: number } | null {
        const gs = this.level.paging?.groups;
        if (!gs?.length) return null;
        return gs[normalizePage(this.level.paging!.page, gs.length)] ?? null;
    }

    /** 这一层总共几页；没有分页状态时恒为 1。 */
    #pageCount(): number {
        if (this.level.paging?.groups?.length) return this.level.paging.groups.length;
        return this.level.paging ? pageCount(this.level.sectors.length) : 1;
    }

    /**
     * 胶囊的 `‹ ›` 现在管什么。**分页优先于 MAP 翻选** ——
     * 两者抢同一对箭头，一层不该同时开（见 types.ts 的 paging 注释）。
     */
    #arrowMode(): "page" | "variant" | "none" {
        if (this.level.paging && this.#pageCount() > 1) return "page";
        if ((this.level.variant?.labels.length ?? 0) > 1) return "variant";
        return "none";
    }

    /**
     * 往这个方向还走不走得动（`+1` 下一项 / `-1` 上一项）。
     *
     * ★★ **不循环**（Nous 2026-08-07："不要无限滚轮：1>2>3 就停下，
     *   然后左右键会因为到底了置灰"）。
     *   循环的毛病是**没有边界反馈**：翻到最后一页再点一下，画面变了，
     *   但玩家以为自己翻过了头还是没翻动 —— 他得读页码才知道。
     *   到底就停 + 箭头变灰，手感和页码是同一件事，不用读数字。
     */
    #canStep(delta: number): boolean {
        const mode = this.#arrowMode();
        if (mode === "page") {
            const p = this.level.paging!.page;
            return delta > 0 ? p < this.#pageCount() - 1 : p > 0;
        }
        if (mode === "variant") {
            const v = this.level.variant!;
            return delta > 0 ? v.index < v.labels.length - 1 : v.index > 0;
        }
        return false;
    }

    /**
     * 往这个方向走一步；走不动就什么都不做（**不循环**）。
     * @returns 真的动了没有
     */
    #step(delta: number): boolean {
        if (!this.#canStep(delta)) return false;
        const mode = this.#arrowMode();
        if (mode === "page") this.level.paging!.page += delta;
        else if (mode === "variant") this.level.variant!.index += delta;
        void this.render(false);
        return true;
    }

    _replaceHTML(result: SVGElement, content: HTMLElement): void {
        content.replaceChildren(result);
        content.addEventListener("click", this.#onClick);
        content.addEventListener("mouseover", this.#onHover);
        // 重绘会换掉内容，所以监听每次都要重挂。
        // ⚠ **这里绝不能顺手续期**：重绘不只来自用户操作，双向绑定的数据刷新
        //   也会重绘。写在这里的话，角色身上有个每几秒跳一次的效果，
        //   轮盘就永远不会自动收起（2026-08-05 实测到过）。只有真实交互才续期。
        // ⚠ `passive: false` 不能省：被动监听里 preventDefault 无效，
        //    滚轮会穿到画布上把地图缩掉，而只在控制台给一句警告
        content.addEventListener("wheel", this.#onWheel, { passive: false });
    }

    /**
     * 续上"无操作自动收起"的计时（Nous 2026-08-05 提出：晾着不动会挡视野）。
     * 任何交互——移动鼠标、点击、翻页、重绘——都会重新计时。
     */

    /**
     * 滚轮 = 翻页 / 翻档（Nous 2026-08-07："在 ui 里面滚轮没有，我们可以借用这个来做翻页"）。
     *
     * ★ 复用**底部胶囊那套完全一样的逻辑**：`#arrowMode()` 决定这一层的箭头管的是
     *   分页还是 MAP 档位，滚轮就跟着它走。分两套写必然分叉 ——
     *   胶囊翻到第 2 页、滚轮却翻档位，是最难查的那种"看起来随机"的毛病。
     *
     * ⚠ 必须 `preventDefault`：不挡的话滚轮会穿到画布上去缩放地图，
     *   玩家想翻页却把整张图缩没了。
     * ⚠ `passive: false` 不能省 —— 被动监听里 preventDefault 无效且只在控制台给一句警告。
     */
    #onWheel = (ev: WheelEvent): void => {
        const mode = this.#arrowMode();
        if (mode === "none") return;
        ev.preventDefault();
        ev.stopPropagation();
        // 向下滚 = 下一项。触控板会给很小的 deltaY，只取方向不取大小。
        // 到头就不动 —— 与箭头共用 #step，两者不可能给出不同的边界行为。
        this.#step(ev.deltaY > 0 ? 1 : -1);
    };

    #onClick = (ev: MouseEvent): void => {
        const el = ev.target as HTMLElement;

        // —— 底部胶囊导航：‹ 上一项 · ↩ 返回 · › 下一项 ——
        const nav = el?.dataset?.nav;
        if (nav) {
            if (nav === "prev" || nav === "next") {
                // 到头就不动（见 #canStep）——分页与 MAP 档位共用同一条边界规则
                this.#step(nav === "next" ? 1 : -1);
            } else if (nav === "undo") {
                this.onUndo?.();
                void this.render(false);
            } else if (nav === "back") {
                this.onPick({ id: "__back", label: "Back", cost: null, state: "normal" }, ev);
            }
            return;
        }

        /*
         * —— 毂里的说明：点开游戏自己的说明窗 ——
         *
         * ★ 必须排在 `data-index` 之前：说明行没有 index，但**顺序写反了**
         *   以后加别的可点毂内元素容易踩。
         * ⚠ 它**不算"选了这一格"** —— 看说明和执行动作是两件事，
         *   合成一件会让人不敢去看（怕点出去一次攻击）。
         */
        const info = el?.dataset?.info;
        if (info) { this.onInfo?.(info); return; }

        const idx = el?.dataset?.index;
        if (idx === undefined) return;
        const sector = this.level.sectors[Number(idx)];
        if (sector) this.onPick(sector, ev);
    };


    /**
     * 画标题，长名字**先缩后断**（Nous 2026-08-07："这种太长的名字的需要缩小字号并且换行"）。
     *
     * ★★ **宽度是量出来的，不是算出来的。**
     *   我第一版按"每单位 ≈ 0.84 × 字号"推预算 —— 实测差了三成
     *   （Signika 比那个系数宽，标题还带 0.5px 的 letter-spacing），
     *   于是"缩完了"的标题照样顶出去 18 个单位。
     *   ⚠ 这个错**看不出来**：缩放确实生效了，只是缩得不够。
     *   ★ 元素已经在 DOM 里，`getBBox()` 一量就有真值 —— 别为省一次测量去猜一个系数。
     *
     * ⚠⚠ **锚只钉第一行**。名字是锚（playbook 总纲），它的 y 必须是常量；
     *   第二行往下长，说明区跟着让位 —— 让位的是**解释**，不是锚。
     *
     * @returns `h` = 第二行占掉的额外高度（0 = 只有一行）；
     *          `truncated` = 名字**没显示全**（收了省略号）——上层据此挂全名提示
     */
    #画标题(g: SVGGElement, text: string, y: number, cls: string, infoUuid?: string):
            { h: number; truncated: boolean } {
        const 画 = (t: string, yy: number): SVGTextElement => {
            const el = document.createElementNS(SVG_NS, "text") as SVGTextElement;
            el.setAttribute("x", String(CX));
            el.setAttribute("y", String(yy));
            el.setAttribute("class", infoUuid ? `${cls} linkable` : cls);
            el.textContent = t;
            // ★ 名字自己就是"点开完整说明"的按钮（Nous 2026-08-08）
            if (infoUuid) el.dataset.info = infoUuid;
            g.appendChild(el);
            return el;
        };
        // 这一行所在高度真正放得下多宽（弦长，两侧各留一点）
        const dy = y - CY;
        const 可用 = 2 * Math.sqrt(Math.max(0, R_HUB * R_HUB - dy * dy)) - HUB_TITLE_MARGIN;

        const 第一 = 画(text, y);
        let 宽 = 第一.getBBox().width;
        if (宽 <= 可用) return { h: 0, truncated: false };

        // ① 缩 —— 缩到刚好，但不低于下限
        const scale = Math.max(HUB_TITLE_MIN_SCALE, 可用 / 宽);
        第一.setAttribute("font-size", `${(HUB_TITLE_PX * scale).toFixed(2)}px`);
        宽 = 第一.getBBox().width;
        if (宽 <= 可用) return { h: 0, truncated: false };

        // ② 还放不下 → 断两行。⚠ 预算按**缩后实测**的每单位宽度算，不用任何系数
        const 每单位 = 宽 / Math.max(1, textWidth(text));
        const 行 = wrapText(text, 可用 / 每单位);
        const lh = HUB_TITLE_PX * scale * HUB_TITLE_LH_RATIO;
        第一.textContent = 行[0];
        if (行.length <= 1) return { h: 0, truncated: false };
        // 三行以上放不下：第二行收省略号，全名交给悬停提示（见 #全名提示）
        const 收了 = 行.length > 2;
        const 第二 = 画(收了 ? 行[1] + "…" : 行[1], y + lh);
        第二.setAttribute("font-size", `${(HUB_TITLE_PX * scale).toFixed(2)}px`);
        return { h: lh, truncated: 收了 };
    }

    /**
     * 画法术位点阵图。
     *
     * ★ 形态是 Nous 2026-08-08 定的："纵是剩余 slot 的点，等于 4 就显示 4 个点，
     *   大于上面还在加一个 `^`；横就是角色有的环数量，下方写 spell slots。"
     *   加上："用掉了的 slot 之后就置灰。"
     *
     * ★ 为什么它比原来那行 `2nd Rank ◈ 4/4` 好：那一行只说得了**当前这一环**，
     *   而选环时要比的是**各环还剩多少**。点阵一眼给全，占的地方还更小。
     *
     * ⚠ 由下往上填：剩下的在底下（电池的样子），用掉的灰点浮在上面。
     *   反过来画的话"还剩几个"要从顶上数下来，多一步换算。
     */
    #画点阵(g: SVGGElement, slots: NonNullable<WheelLevel["slots"]>, 将花掉 = -1): void {
        const cols = slots.columns;
        if (!cols.length) return;
        const 总宽 = (cols.length - 1) * SLOT_COL;
        cols.forEach((c, ci) => {
            const x = CX - 总宽 / 2 + ci * SLOT_COL;
            const 画几行 = Math.min(SLOT_MAX_ROWS, c.max);
            const 本列 = ci === slots.current;
            for (let r = 0; r < 画几行; r++) {
                const dot = document.createElementNS(SVG_NS, "circle");
                dot.setAttribute("cx", String(x));
                dot.setAttribute("cy", String(SLOT_BOTTOM_Y - r * SLOT_ROW));
                // 由下往上：前 value 个是还剩的，其余是用掉的（灰且更小，见 SLOT_SPENT_R）
                const 还在 = r < c.value;
                dot.setAttribute("r", String(还在 ? SLOT_R : SLOT_R * SLOT_SPENT_R));
                dot.setAttribute("class", `pauih-slot-dot${还在 ? "" : " spent"}`
                    + (本列 ? " current" : "")
                    + (本列 && r === 将花掉 ? " next" : ""));
                g.appendChild(dot);
            }
            // 超过画得下的行数 → 顶上一个 `^`，表示"上面还有"
            if (c.max > SLOT_MAX_ROWS) {
                const t = document.createElementNS(SVG_NS, "text");
                t.setAttribute("x", String(x));
                t.setAttribute("y", String(SLOT_BOTTOM_Y - SLOT_MAX_ROWS * SLOT_ROW));
                /*
                 * ⚠ 要花掉的那个位**画不出来**时（余量多于画得下的行数），
                 *   预示落到 `^` 上，而不是退而求其次去点亮第 4 个点 ——
                 *   那会指着一个错的位，是"看起来正确的错数"（playbook 12）。
                 */
                t.setAttribute("class", `pauih-slot-more${本列 ? " current" : ""}`
                    + (本列 && 将花掉 >= SLOT_MAX_ROWS ? " next" : ""));
                t.textContent = "^";
                g.appendChild(t);
            }
        });
        const label = document.createElementNS(SVG_NS, "text");
        label.setAttribute("x", String(CX));
        label.setAttribute("y", String(SLOT_LABEL_Y));
        label.setAttribute("class", "pauih-slot-label");
        label.textContent = "spell slots";
        g.appendChild(label);
    }

    #onHover = (ev: MouseEvent): void => {
        // ⚠ 这里**不续期**空闲计时：光标停着不动时，重绘换掉脚下的节点
        //   浏览器照样会补发一次 mouseover —— 那不是"用户在操作"。
        //   只有真正的指针移动（mousemove）与点击才算（2026-08-05 实测踩到）。
        const el = ev.target as HTMLElement;
        // ⚠ 翻选条自己不触发重画：它就住在毂文字那个 <g> 里，重画会把光标脚下的
        //   节点换掉，浏览器随即再发一次 mouseover → 无限重画。
        //   （其余毂内元素都是 pointer-events:none，只有它是可点的，所以只有它有这个问题。）
        if (el?.dataset?.nav !== undefined) return;

        const idx = el?.dataset?.index;
        const g = this.element?.querySelector(".pauih-hub-text") as SVGGElement | null;
        if (!g) return;

        /*
         * ★★ **离开扇区不清空毂 —— 停在最后悬停过的那一格**
         *   （Nous 2026-08-07 实机发现，我观测不到的一类 bug）。
         *
         *   原来是"鼠标一离开扇区就画回层标题"。那让毂里那几行**可点的说明
         *   永远点不到**：要去点它就必须把鼠标从扇区上移开，
         *   而那一下移动**正好把它抹掉**。
         *   ★ 一句话：**到达它所需的动作，恰好是销毁它的动作。**
         *
         * ⚠ 于是"停留"不是偏好，是让那个功能存在的前提。
         * ⚠ 同样的下标不重画：重画会换掉光标脚下的节点，浏览器补发 mouseover →
         *   无限重画（这条坑 2026-08-05 已经踩过一次）。
         */
        if (idx === undefined) return;          // 离开扇区 → 保持现状，不清空
        if (idx !== this.#hoveredIndex) {        // 还在同一格 → 不重画（见上）
            this.#hoveredIndex = idx;
            this.#paintHub(g, this.level.sectors[Number(idx)] ?? null);
        }

        /*
         * ★★ **提示每次进入都重挂**，不受上面那道"同一格不重画"的门管
         *   （Nous 2026-08-08 实机报的）：
         *   > "只要我移开了之后再回去就不会再显示了，就像是显示只有一次一样，
         *   >  但是我看了别的再回去又好了。"
         *
         * ★ 病因是**把两件语义不同的事绑在了同一个判断上**：
         *   - 毂内容是**停留式**的：鼠标离开扇区照旧留着（见上面那段），
         *     所以 `#hoveredIndex` 记的是"毂里现在画的是谁"——它在鼠标离开后**不清**；
         *   - 提示是**跟随式**的：它答的是"鼠标此刻在不在这一格上"。
         *   拿「毂要不要重画」去管「提示要不要弹」，回到同一格时两件事就一起被跳过了。
         *   ★ "夹一格就好了"正是 `idx !== #hoveredIndex` 这个判据的形状 ——
         *     复现路径本身就指着病因，这类症状值得先照着判据倒推一遍再开查。
         *
         * ⚠ 挪出来是安全的：这一句**不重画 SVG**，只调 `game.tooltip`，
         *   碰不到"换掉光标脚下节点 → 浏览器补发 mouseover → 无限重画"那条老坑。
         * ⛔ 不要为了"少弹一次"再加去重条件 —— 上一版就是这么坏的。
         *   `#全名提示` 自己先 deactivate 再 activate，重复调用是幂等的。
         */
        this.#全名提示(el);
    };

    /**
     * 毂里那个名字**没显示全**时的全名；显示全了就是 null。
     * 由 `#画标题` 每次重画时写，`#全名提示` 读它决定要不要弹黑框。
     */
    #全名: string | null = null;

    /**
     * 名字放不下时，在**轮盘上方**弹一个黑框写全名
     * （Nous 2026-08-07："做成 hover 会在 ui 上方显现黑框然后写全名"）。
     *
     * ★★ **用 Foundry 自己的提示层，不自己画一个**：
     *   它的 z-index 是 9999（我们的窗是 app+10），天然压在轮盘上面；
     *   跟随、延迟、消失、配色全是现成的，还与用户的主题一致。
     *   自己画一个要重做这一整套，而且一定跟 core 的长得不一样。
     *
     * ⚠ 挂在**扇区元素**上而不是毂上：提示要指着"你正指的那一格"，
     *   指着毂的话玩家不知道它在说谁。
     * ⚠ 每次悬停都要先关再开 —— 不关的话换一格时旧提示会留在原地。
     */
    #全名提示(el: Element | null): void {
        const tip = (game as any)?.tooltip;
        if (!tip) return;
        try {
            tip.deactivate?.();
            if (el && this.#全名) tip.activate?.(el, { text: this.#全名, direction: "UP" });
        } catch (err) {
            console.error("player-action-ui-hub | 全名提示失败", err);
        }
    }

    /**
     * 毂里现在显示的是哪一格（`data-index` 的原文），`null` = 还没悬停过任何一格。
     *
     * ⚠ 换层时必须清掉 —— 不清的话新层第一眼显示的是**上一层某一格**的说明。
     * ⚠⚠ **它只回答"毂里画的是谁"，不回答"鼠标在哪"**（2026-08-08 钉死）：
     *   毂是停留式的，鼠标离开扇区之后这个值照旧留着。
     *   任何"鼠标此刻在不在某格上"的判断都**不能**拿它当依据 ——
     *   全名提示就是这么坏过一次的（见 `#onHover` 末尾）。
     */
    #hoveredIndex: string | null = null;

    /**
     * 在指定屏幕坐标处弹出（**以该点为圆心**），并接管 Esc 与点击盘外关闭。
     * 靠近屏幕边缘时会把盘面拉回可视区内，否则贴边呼出会有半个盘在屏幕外、扇区点不到。
     */
    async openAt(x: number, y: number): Promise<void> {
        await this.render(true);

        const margin = 4;
        const left = clamp(x - SIZE / 2, margin, window.innerWidth - SIZE - margin);
        const top = clamp(y - SIZE / 2, margin, window.innerHeight - SIZE - margin);
        this.setPosition({ left, top });

        // ★ Esc 必须自己接管，不能指望 Foundry。
        //   实读 client/helpers/interaction/client-keybindings.mjs:754-756：
        //   Esc 遍历 foundry.applications.instances 时有一道 `if (app.hasFrame)` 门槛，
        //   而我们是无框窗（window.frame:false）→ hasFrame 为假 → Foundry 永远不会关我们。
        //   （2026-08-04 实测确认：不挂这个监听，Esc 对轮盘完全无效。）
        this.escHandler = (ev: KeyboardEvent) => {
            if (ev.key !== "Escape") return;
            ev.preventDefault();
            ev.stopPropagation();     // 别让 Esc 继续冒泡去开主菜单
            void this.close();
        };


        // 延后一帧挂载，避免呼出那一次按键立刻把自己关掉
        setTimeout(() => {
            document.addEventListener("keydown", this.escHandler!, { capture: true });
        }, 0);
    }

    /**
     * 关盘时要收拾的**盘外状态**（目前只有一处：选目标层预选的那些目标）。
     *
     * ⚠ 必须挂在这里而不是各个关盘调用点：关的路有三条
     *   （Esc、返回退到底、执行完自动关），漏掉任何一条都会**把选中的目标留在画布上** ——
     *   而盘一关就没有取消它们的入口了。
     *   ★ Nous 2026-08-08 实机撞到的就是这个："我被夹在这个无法清除的选择框里面。"
     */
    onClosed?: () => void;

    async close(options: object = {}): Promise<this> {
        // 关了就别再自动重算：钩子还会继续放，让它们扑空即可
        this.rebuild = undefined;
        try { this.onClosed?.(); } catch (err) {
            console.error("player-action-ui-hub | onClosed 失败", err);
        }
        // ⚠ 提示活在 Foundry 的层里、不在我们的 DOM 里 —— 关窗**不会**把它带走，
        //   不显式关掉就留一个黑框浮在画布上（而且指着一个已经没了的元素）
        this.#全名 = null;
        this.#全名提示(null);
        if (this.escHandler) {
            document.removeEventListener("keydown", this.escHandler, { capture: true });
            this.escHandler = undefined;
        }
        return super.close(options) as Promise<this>;
    }
}
