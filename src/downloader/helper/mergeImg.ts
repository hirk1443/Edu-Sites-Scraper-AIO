import sharp from "sharp";
import type { Sharp, OverlayOptions } from "sharp";

export async function mergeImgVertical(images: (Buffer | string | Sharp)[], {
    color = "#FFFFFF"
} = {})
{
    const newImages = images.map(img => (typeof img === 'string' || Buffer.isBuffer(img)) ? sharp(img) : img);
    const compositeInput: OverlayOptions[] = [];
    let width = 0, height = 0;
    for (const img of newImages)
    {
        const { width: imgWidth, height: imgHeight } = await img.metadata();
        compositeInput.push({
            input: await img.toBuffer(),
            top: height,
            left: 0
        });
        width = Math.max(width, imgWidth!);
        height += imgHeight!;
    };
    return sharp({
        create: {
            width, height,
            channels: 3,
            background: "#FFFFFF"
        }
    }).composite(compositeInput)
}