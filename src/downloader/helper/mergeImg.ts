import sharp from "sharp";
import type { Sharp, OverlayOptions } from "sharp";

export async function mergeImgVertical(images: (Buffer | string | Sharp)[], {
    color = "#FFFFFF"
} = {})
{
    const newImages = images.map(img => (typeof img === 'string' || Buffer.isBuffer(img)) ? sharp(img) : img);
    const width = Math.max(...await Promise.all(newImages.map(img => img.metadata().then(
        ({width}) => width!
    ))));
    const compositeInput: OverlayOptions[] = [];
    let height = 0;
    for (const img of newImages)
    {
        const { width: imgWidth, height: imgHeight } = await img.metadata();
        compositeInput.push({
            input: await img.toBuffer(),
            top: height,
            left: 0
        });
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