const { Vec3 } = require('vec3');

class BasePrinter {
    constructor() {
        this.BLOCK_EQUIVALENT_LIST = {
            "空氣": ["air", "water", "brown_mushroom"],
            "土": ["grass_block", "dirt", "mycelium"],
            "test": ["quartz_pillar", "cobblestone"],
            "竹子": ["bamboo", "bamboo_sapling"]
        };
    }

    pos_in_box(pos, start, end) {
        let s = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), z: Math.min(start.z, end.z) };
        let e = { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y), z: Math.max(start.z, end.z) };
        if (pos.x < s.x || pos.y < s.y || pos.z < s.z) return false;
        if (pos.x > e.x || pos.y > e.y || pos.z > e.z) return false;
        return true;
    }

    checkBlock(block, targetPalette) {
        if (block == null) return 0;
        if (block.name == targetPalette.Name) {
            return 1;
        }
        let target_PT_eq_ID = undefined;
        for (let i in this.BLOCK_EQUIVALENT_LIST) {
            if (this.BLOCK_EQUIVALENT_LIST[i].includes(targetPalette.Name)) {
                target_PT_eq_ID = i;
                break;
            }
        }
        if (target_PT_eq_ID == undefined) return 0;
        if (this.BLOCK_EQUIVALENT_LIST[target_PT_eq_ID].includes(block.name)) return 1;
        return 0;
    }

    async placeWithProperties(bot, block, pos, Item) {
        let direction = 0;
        let pitch = 0;
        let yaw = 0;

        if (block?.Properties?.half == 'bottom' || block?.Properties?.type == 'bottom') direction = 1;
        if (block?.Properties?.axis == 'y') direction = 0;
        if (block?.Properties?.axis == 'x') direction = 4;
        if (block?.Properties?.axis == 'z') direction = 2;

        if (block?.Properties?.facing == 'south') yaw = 0;
        if (block?.Properties?.facing == 'west') yaw = 90;
        if (block?.Properties?.facing == 'north') yaw = 180;
        if (block?.Properties?.facing == 'east') yaw = 270;
        if (block?.Properties?.facing == 'up') { direction = 1; pitch = 90; }
        if (block?.Properties?.facing == 'down') { direction = 0; pitch = -90; }

        if (block?.Properties?.facing && block.Name.includes("anvil")) {
            yaw = (yaw + 270) % 360;
        }

        if (block.Name.includes("trapdoor") || block.Name.includes("button") || block.Name.includes("_glazed_")) {
            if (block?.Properties?.facing == 'north') yaw = 0;
            if (block?.Properties?.facing == 'east') yaw = 90;
            if (block?.Properties?.facing == 'south') yaw = 180;
            if (block?.Properties?.facing == 'west') yaw = 270;
        }

        bot._client.write('position_look', {
            x: bot.entity.position.x,
            y: bot.entity.position.y,
            z: bot.entity.position.z,
            yaw: yaw,
            pitch: pitch,
            onGround: false
        });

        const packet = {
            location: pos,
            direction: direction,
            heldItem: Item.toNotch(bot.heldItem),
            cursorX: 0.5,
            cursorY: 0.5,
            cursorZ: 0.5
        };
        bot._client.write('block_place', packet);
    }
}

module.exports = BasePrinter;
