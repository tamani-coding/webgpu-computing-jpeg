export const shader_invert = `
struct Size {
    size: vec2<u32>;
};

struct Image {
    rgba: array<u32>;
};

[[group(0), binding(0)]] var<storage> widthHeight: [[access(read)]] Size;
[[group(0), binding(1)]] var<storage> inputPixels: [[access(read)]] Image;
[[group(0), binding(2)]] var<storage> outputPixels: [[access(write)]] Image;

[[stage(compute)]]
fn main ([[builtin(global_invocation_id)]] global_id: vec3<u32>) {
    let index : u32 = global_id.x + global_id.y * widthHeight.size.x;
    outputPixels.rgba[index] = 4294967295u - inputPixels.rgba[index];
}
`

const laplace_3x3 = `
struct Size {
    size: vec2<f32>;
};

struct Image {
  rgba: array<u32>;
};

[[group(0), binding(0)]] var<storage> widthHeight : [[access(read)]] Size;
[[group(0), binding(1)]] var<storage> inputPixels : [[access(read)]] Image;
[[group(0), binding(2)]] var<storage> outputPixels : [[access(write)]] Image;

[[stage(compute)]]
fn main([[builtin(global_invocation_id)]] global_id : vec3<u32>) {
    let resultCell : vec2<u32> = vec2<u32>(global_id.x, global_id.y);
    let index : u32 = resultCell.x + resultCell.y * u32(widthHeight.size.x);
    if (resultCell.x > 0u && resultCell.y > 0u && resultCell.x < (u32(widthHeight.size.x) - 1u) && resultCell.y < (u32(widthHeight.size.y) - 1u)) {
    
        let w00_i : u32 = resultCell.x - 1u + (resultCell.y - 1u) * u32(widthHeight.size.x);
        let w10_i : u32 = resultCell.x - 1u + resultCell.y * u32(widthHeight.size.x);
        let w20_i : u32 = resultCell.x - 1u + (resultCell.y + 1u) * u32(widthHeight.size.x);
    
        let w01_i : u32 = resultCell.x + (resultCell.y - 1u) * u32(widthHeight.size.x);
        let w11_i : u32 = resultCell.x + resultCell.y * u32(widthHeight.size.x);
        let w21_i : u32 = resultCell.x + (resultCell.y + 1u) * u32(widthHeight.size.x);
    
        let w02_i : u32 = resultCell.x + 1u + (resultCell.y - 1u) * u32(widthHeight.size.x);
        let w12_i : u32 = resultCell.x + 1u + resultCell.y * u32(widthHeight.size.x);
        let w22_i : u32 = resultCell.x + 1u + (resultCell.y + 1u) * u32(widthHeight.size.x);
    
        let tmp : u32 =(- u32(0u) * inputPixels.rgba[w00_i]   - u32(1u) * inputPixels.rgba[w01_i] - u32(0u) * inputPixels.rgba[w02_i]
                        - u32(1u) * inputPixels.rgba[w10_i]   + u32(4u) * inputPixels.rgba[w11_i] - u32(1u) * inputPixels.rgba[w12_i]
                        - u32(0u) * inputPixels.rgba[w20_i]   - u32(1u) * inputPixels.rgba[w21_i] - u32(0u) * inputPixels.rgba[w22_i] );

        outputPixels.rgba[index] =  u32(tmp);
    } else {
        outputPixels.rgba[index] = u32(0);
    }
}
`