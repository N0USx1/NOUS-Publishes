import { describe, it, expect } from "vitest";
import { linkedEffectUuid, buildMarkEffect } from "../src/marks";

// buildMarkEffect 用到 foundry 的工具函数；测试里给个最小实现
(globalThis as any).foundry = {
    utils: {
        deepClone: (o: any) => JSON.parse(JSON.stringify(o)),
        setProperty: (o: any, path: string, v: any) => {
            const ks = path.split("."); let cur = o;
            for (const k of ks.slice(0, -1)) cur = (cur[k] ??= {});
            cur[ks.at(-1)!] = v;
        },
    },
};

describe("linkedEffectUuid：uuid 就写在动作自己的描述里", () => {
    // 实测取自 pf2e 的 Taunt 描述
    const taunt = `<p>…you also become @UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Off-Guard}…`
        + ` @UUID[Compendium.pf2e.feat-effects.Item.FlyWq9znOHvpISNW]{Effect: Taunt}</p>`;

    it("取得出效果 uuid —— 一条登记表都不用写", () => {
        expect(linkedEffectUuid(taunt)).toBe("Compendium.pf2e.feat-effects.Item.FlyWq9znOHvpISNW");
    });

    it("★★ 判据是显示名以 Effect: 开头，**不是「第一个链接」**", () => {
        // 实测 Taunt 描述里第一个链接是 Off-Guard（一个条件），
        // 取第一个会把条件当成效果贴到敌人身上
        expect(linkedEffectUuid(taunt)).not.toMatch(/conditionitems/);
    });

    it("没有效果链接就是 null —— 不兜底猜一个", () => {
        expect(linkedEffectUuid(`<p>@UUID[Compendium.pf2e.conditionitems.Item.x]{Off-Guard}</p>`)).toBeNull();
        expect(linkedEffectUuid("")).toBeNull();
        expect(linkedEffectUuid(null)).toBeNull();
    });
});

describe("buildMarkEffect：origin 填错不报错，所以必须测", () => {
    const src = { name: "Effect: Taunt", system: { slug: "effect-taunt", rules: [] } };
    const origin = { actorUuid: "Actor.me", itemUuid: "Actor.me.Item.taunt", tokenUuid: "Scene.s.Token.t" };

    it("★★ origin 必须填上 —— 少了它那个 −1 会对**所有人**生效，包括守护者自己", () => {
        // pf2e 的谓词读的是 {item|origin.signature}
        const d = buildMarkEffect(src, origin);
        expect(d.flags.pf2e.origin.actor).toBe("Actor.me");
        expect(d.flags.pf2e.origin.item).toBe("Actor.me.Item.taunt");
        expect(d.flags.pf2e.origin.token).toBe("Scene.s.Token.t");
    });

    it("打上我们自己的标记，将来认得出是谁贴的", () => {
        expect(buildMarkEffect(src, origin).flags["player-action-ui-hub"].autoApplied).toBe(true);
    });

    it("★ 不改原始来源（拿的是纲要文档，改了会污染缓存）", () => {
        buildMarkEffect(src, origin);
        expect((src as any).flags).toBeUndefined();
    });

    it("没有令牌时 token 记成 null，不留 undefined", () => {
        const d = buildMarkEffect(src, { actorUuid: "Actor.me", itemUuid: "i" });
        expect(d.flags.pf2e.origin.token).toBeNull();
    });
});
