import { describe, it, expect } from "vitest";
import { strikeSectorId, ammoSectorId, parseAmmoSectorId } from "../src/collectors/strikes";

/*
 * 弹药扇区 id 的编解码。
 *
 * ⚠ 这一组钉的是**已经发生过的**事故（2026-08-08，Nous 实机）：
 *   > "说是填了但是没有真的填，还会说已经装填了。"
 *   > （开炮）"No ammunition is assigned to +1 Striking Dwarven Scattergun."
 *
 *   病因是 `const [, strikeKey, ammoId] = id.split(":")` —— 而 `strikeKey`
 *   自己带一个冒号（`strike:<itemId>`），于是切出来的两段**都指向了别的东西**，
 *   并且**两边都不报错**：回查打击落空 → 空位算成 0 → 说"已经装填了"；
 *   按武器 id 找弹药 → 找不到 → 一发也没装。
 *
 * ★ 所以这里验的不是"字符串拼得对不对"，是**编码与解码是不是一对**。
 */

/** 造一个真实形状的 strikeKey —— 关键是它自己带冒号。 */
const 打击键 = (itemId: string) => strikeSectorId({ item: { id: itemId } } as never, 0);

describe("strikeSectorId 自己就带一个冒号（下面所有坑的前提）", () => {
    it("★ 形如 strike:<itemId>", () => {
        expect(打击键("AbC123")).toBe("strike:AbC123");
        expect(打击键("AbC123").split(":").length).toBe(2);
    });
});

describe("ammoSectorId ↔ parseAmmoSectorId 往返", () => {
    it("★★ 回归：真实形状的 id 解得回原来那两个值", () => {
        const key = 打击键("jtdeYiY0rMUw1SzP");
        const id = ammoSectorId(key, "G62W5Thvn4ZnxhLU");
        expect(id).toBe("ammo:strike:jtdeYiY0rMUw1SzP:G62W5Thvn4ZnxhLU");
        expect(parseAmmoSectorId(id)).toEqual({
            strikeKey: "strike:jtdeYiY0rMUw1SzP",
            ammoId: "G62W5Thvn4ZnxhLU",
        });
    });

    it("★ 反向用例：钉住老写法为什么错（按固定下标解构）", () => {
        const id = ammoSectorId(打击键("jtdeYiY0rMUw1SzP"), "G62W5Thvn4ZnxhLU");
        // 这是上一版的写法，原样重现
        const [, 老key, 老ammo] = id.split(":");
        expect(老key).toBe("strike");                 // ✗ 拿到的是前缀，不是打击
        expect(老ammo).toBe("jtdeYiY0rMUw1SzP");      // ✗ 拿到的是**武器 id**，不是弹药
        // 正解
        const 新 = parseAmmoSectorId(id)!;
        expect(新.strikeKey).not.toBe(老key);
        expect(新.ammoId).not.toBe(老ammo);
    });

    it("strikeKey 退化成 slug 或下标时照样往返（没有 item.id 的打击）", () => {
        for (const k of ["strike:some-slug", "strike:3"]) {
            const id = ammoSectorId(k, "AmmoId0000000001");
            expect(parseAmmoSectorId(id)).toEqual({ strikeKey: k, ammoId: "AmmoId0000000001" });
        }
    });

    it("★ 就算 strikeKey 里再多几个冒号也不丢段（变长段在中间，靠 join 还原）", () => {
        const k = "strike:a:b:c";
        expect(parseAmmoSectorId(ammoSectorId(k, "Z1"))).toEqual({ strikeKey: k, ammoId: "Z1" });
    });

    it("不是弹药 id 的一律返回 null，别拿半个 id 往下走", () => {
        expect(parseAmmoSectorId("strike:AbC123")).toBeNull();
        expect(parseAmmoSectorId("reload:strike:AbC123")).toBeNull();
        expect(parseAmmoSectorId("ammo:")).toBeNull();
        expect(parseAmmoSectorId("ammo:onlyonepart")).toBeNull();
        expect(parseAmmoSectorId("")).toBeNull();
    });

    it("★ reload 格的 id 切掉前缀之后，正好就是 ammoSectorId 要的 strikeKey", () => {
        // main.ts 里那条链：reload:<strikeKey> → slice → ammoSectorId(strikeKey, ammoId)
        const key = 打击键("jtdeYiY0rMUw1SzP");
        const reloadId = `reload:${key}`;
        expect(reloadId.slice("reload:".length)).toBe(key);
        expect(parseAmmoSectorId(ammoSectorId(reloadId.slice("reload:".length), "X1"))!.strikeKey)
            .toBe(key);
    });
});
