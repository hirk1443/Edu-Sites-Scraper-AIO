import pMap from "p-map";
import { CookieJar } from "tough-cookie";

import type { Protocol } from "puppeteer";

export async function toToughCookieJar(cookies: Protocol.Network.Cookie[], url: string)
{
    const cookieJar = new CookieJar();
    await pMap(cookies, ({ name, value }) => cookieJar.setCookie(`${name}=${value}`, url));
    return cookieJar;
}
