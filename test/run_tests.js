const { LuaFactory } = require('wasmoon');
const fs = require('fs');
const assert = require('assert');

// Read Lua files
const heightInitLua = fs.readFileSync('scripts/Height.lua', 'utf8');
const managerHeightLua = fs.readFileSync('scripts/manager_height.lua', 'utf8');
const managerTokenLua = fs.readFileSync('scripts/manager_token.lua', 'utf8');

// Helper to run a test and catch errors
async function runTest(name, testFn) {
    console.log(`Running test: ${name}...`);
    try {
        await testFn();
        console.log(`\x1b[32mPASS\x1b[0m: ${name}\n`);
    } catch (err) {
        console.error(`\x1b[31mFAIL\x1b[0m: ${name}`);
        console.error(err);
        process.exit(1);
    }
}

// Helper to initialize Lua VM and load mocks
async function setupLuaEnv() {
    const factory = new LuaFactory();
    const lua = await factory.createEngine();

    // 1. Mock DB
    await lua.doString(`
        DB = {}
        DB._nodes = {}
        DB._handlers = {}

        local function createNode(path, nodeType, value)
            if DB._nodes[path] then return DB._nodes[path] end

            local node = {
                _path = path,
                _type = nodeType,
                _value = value or 0,
                _owner = "",
                _holders = {},
                _children = {},
            }
            
            node.getPath = function(self)
                return node._path
            end
            
            node.getValue = function(self)
                return node._value
            end
            
            node.setValue = function(self, val)
                local actualVal = val
                if _G.type(self) == "table" and self.getPath then
                    actualVal = val
                else
                    actualVal = self
                end
                local old = node._value
                node._value = actualVal
                DB._trigger(node._path, old, actualVal)
            end
            
            node.getOwner = function(self)
                return node._owner
            end
            
            node.setOwner = function(self, owner)
                local actualOwner = owner
                if _G.type(self) == "table" and self.getPath then
                    actualOwner = owner
                else
                    actualOwner = self
                end
                node._owner = actualOwner
            end
            
            node.addHolder = function(self, owner, bVal)
                local actualOwner, actualBVal
                if _G.type(self) == "table" and self.getPath then
                    actualOwner = owner
                    actualBVal = bVal
                else
                    actualOwner = self
                    actualBVal = owner
                end
                node._holders[actualOwner] = actualBVal
            end
            
            node.isReadOnly = function(self)
                return false
            end
            
            node.createChild = function(self, name, childType)
                local actualName
                if _G.type(self) == "table" and self.getPath then
                    actualName = name
                else
                    actualName = self
                end
                local childPath = node._path == "" and actualName or (node._path .. "." .. actualName)
                if not node._children[actualName] then
                    node._children[actualName] = createNode(childPath, childType)
                end
                return node._children[actualName]
            end
            
            node.getChild = function(self, name)
                local actualName
                if _G.type(self) == "table" and self.getPath then
                    actualName = name
                else
                    actualName = self
                end
                return node._children[actualName]
            end
            
            node.getParent = function(self)
                local parentPath = node._path:match("(.*)%.[^%.]+$") or ""
                return DB.findNode(parentPath)
            end
            
            node.getChildren = function(self)
                return node._children
            end

            DB._nodes[path] = node
            return node
        end

        DB._nodes[""] = createNode("", "node")

        DB.findNode = function(path)
            return DB._nodes[path]
        end

        DB.createNode = function(path, value)
            local parts = {}
            for part in path:gmatch("[^%.]+") do
                table.insert(parts, part)
            end
            
            local current = DB.findNode("")
            local currentPath = ""
            for i = 1, #parts do
                local part = parts[i]
                currentPath = currentPath == "" and part or (currentPath .. "." .. part)
                local child = current:getChild(part)
                if not child then
                    child = createNode(currentPath, "node")
                    current._children[part] = child
                end
                current = child
            end
            
            if value ~= nil then
                current:setValue(value)
            end
            
            if path:match("^combattracker%.list%.[^%.]+$") then
                current:createChild("link", "string"):setValue("")
                current:createChild("name", "string"):setValue("")
            end
            
            return current
        end

        DB.getChildren = function(path)
            local n = DB.findNode(path)
            if n then return n:getChildren() end
            return {}
        end

        DB.addHandler = function(pattern, event, callback)
            table.insert(DB._handlers, { pattern = pattern, event = event, callback = callback })
        end

        DB._trigger = function(path, old, val)
            for _, h in ipairs(DB._handlers) do
                local pat = "^" .. h.pattern:gsub("%.", "%%."):gsub("%*", "[^%%.]+") .. "$"
                if path:match(pat) then
                    local node = DB.findNode(path)
                    h.callback(node)
                end
            end
        end
    `);

    // 2. Mock OptionsManager
    await lua.doString(`
        OptionsManager = {}
        OptionsManager._options = {}
        OptionsManager._callbacks = {}

        OptionsManager.registerOption2 = function(name, bLocal, header, label, entry, options)
            OptionsManager._options[name] = options.default or ""
        end

        OptionsManager.registerCallback = function(name, callback)
            OptionsManager._callbacks[name] = callback
        end

        OptionsManager.getOption = function(name)
            return OptionsManager._options[name] or ""
        end

        OptionsManager.setOption = function(name, val)
            OptionsManager._options[name] = val
            if OptionsManager._callbacks[name] then
                OptionsManager._callbacks[name]()
            end
        end
    `);

    // 3. Mock Input
    await lua.doString(`
        Input = {}
        Input._shift = false
        Input._ctrl = false
        Input._alt = false

        Input.isShiftPressed = function() return Input._shift end
        Input.isControlPressed = function() return Input._ctrl end
        Input.isAltPressed = function() return Input._alt end
    `);

    // 4. Mock Session & GameSystem
    await lua.doString(`
        Session = {}
        Session.IsHost = true

        GameSystem = {}
        GameSystem._gridUnits = 5
        GameSystem.getDistanceUnitsPerGrid = function() return GameSystem._gridUnits end
    `);

    // 5. Mock CombatManager
    await lua.doString(`
        CombatManager = {}
        CombatManager._tokenToCT = {}  -- tokenID -> ctNodePath
        CombatManager._ctToToken = {}  -- ctNodePath -> token
        CombatManager._nodeToCT = {}   -- charNodePath -> ctNode

        CombatManager.getCTFromToken = function(token)
            if not token then return nil end
            local id = token:getId()
            local path = CombatManager._tokenToCT[id]
            if path then return DB.findNode(path) end
            return nil
        end

        CombatManager.getTokenFromCT = function(ctNode)
            if not ctNode then return nil end
            local path = ctNode:getPath()
            return CombatManager._ctToToken[path]
        end

        CombatManager.getCTFromNode = function(node)
            if not node then return nil end
            local path = node:getPath()
            local ctPath = CombatManager._nodeToCT[path]
            if ctPath then return DB.findNode(ctPath) end
            return nil
        end
    `);

    // 6. Mock TokenManager
    await lua.doString(`
        TokenManager = {}
        TokenManager.updateTooltip = function(tokenCT, nodeCT) end
        TokenManager.updateNameHelper = function(tokenCT, nodeCT) end
        TokenManager.updateVisibilityHelper = function(tokenCT, nodeCT) end
        TokenManager.updateOwnerHelper = function(tokenCT, nodeCT) end
        TokenManager.updateActiveHelper = function(tokenCT, nodeCT) end
        TokenManager.updateFactionHelper = function(tokenCT, nodeCT) end
        TokenManager.updateEffectsHelper = function(tokenCT, nodeCT) end
        TokenManager.updateTokenColor = function(token) end
    `);

    // 7. Mock ChatManager & Debug
    await lua.doString(`
        ChatManager = {}
        ChatManager._launchMessages = {}
        ChatManager.registerLaunchMessage = function(msg)
            table.insert(ChatManager._launchMessages, msg)
        end

        Debug = {}
        Debug.console = function(...) end
    `);

    // 8. Mock Token & Widget Constructors with Dot & Colon compatibility
    await lua.doString(`
        Token = {}
        Token.onWheel = nil

        function createWidget(font, text)
            local wdg = {
                _font = font,
                _text = text,
                _visible = true,
                _name = "",
                _position = { relation = "", x = 0, y = 0 },
                _frame = { name = "", offset = {} },
                _color = "",
                _isFront = false,
            }
            
            wdg.setVisible = function(self, b)
                local val = b
                if _G.type(self) ~= "table" or self._font == nil then val = self end
                wdg._visible = val
            end
            
            wdg.setName = function(self, name)
                local val = name
                if _G.type(self) ~= "table" or self._font == nil then val = self end
                wdg._name = val
            end
            
            wdg.setPosition = function(self, rel, x, y)
                local actualRel, actualX, actualY
                if _G.type(self) == "table" and self.setVisible then
                    actualRel = rel
                    actualX = x
                    actualY = y
                else
                    actualRel = self
                    actualX = rel
                    actualY = x
                end
                wdg._position = { relation = actualRel, x = actualX, y = actualY }
            end
            
            wdg.setFrame = function(self, name, o1, o2, o3, o4)
                local actualName, actualO1, actualO2, actualO3, actualO4
                if _G.type(self) == "table" and self.setVisible then
                    actualName = name
                    actualO1 = o1
                    actualO2 = o2
                    actualO3 = o3
                    actualO4 = o4
                else
                    actualName = self
                    actualO1 = name
                    actualO2 = o1
                    actualO3 = o2
                    actualO4 = o3
                end
                wdg._frame = { name = actualName, offset = { actualO1, actualO2, actualO3, actualO4 } }
            end
            
            wdg.setColor = function(self, c)
                local val = c
                if _G.type(self) ~= "table" or self._font == nil then val = self end
                wdg._color = val
            end
            
            wdg.bringToFront = function(self)
                wdg._isFront = true
            end
            
            wdg.setText = function(self, t)
                local val = t
                if _G.type(self) ~= "table" or self._font == nil then val = self end
                wdg._text = val
            end
            
            wdg.setFont = function(self, f)
                local val = f
                if _G.type(self) ~= "table" or self._font == nil then val = self end
                wdg._font = val
            end
            
            return wdg
        end

        function createToken(id, w, h)
            local t = {
                _id = id,
                _w = w or 50,
                _h = h or 50,
                _widgets = {},
                _owner = nil,
            }
            
            t.getId = function(self)
                return t._id
            end
            
            t.getSize = function(self)
                return t._w, t._h
            end
            
            t.addTextWidget = function(self, font, text)
                local actualFont, actualText
                if _G.type(self) == "table" and self.getId then
                    actualFont = font
                    actualText = text
                else
                    actualFont = self
                    actualText = font
                end
                local wdg = createWidget(actualFont, actualText)
                table.insert(t._widgets, wdg)
                return wdg
            end
            
            t.findWidget = function(self, name)
                local actualName
                if _G.type(self) == "table" and self.getId then
                    actualName = name
                else
                    actualName = self
                end
                for _, wdg in ipairs(t._widgets) do
                    if wdg._name == actualName then
                        return wdg
                    end
                end
                return nil
            end
            
            t.setOwner = function(self, owner)
                local actualOwner = owner
                if _G.type(self) == "table" and self.getId then
                    actualOwner = owner
                else
                    actualOwner = self
                end
                t._owner = actualOwner
            end
            
            return t
        end
    `);

    // Helper to load extensions script files
    await lua.doString(`
        function loadScriptAsGlobal(scriptCode, globalName)
            local env = {}
            setmetatable(env, { __index = _G })
            _G[globalName] = env
            
            local chunk = assert(load(scriptCode, globalName, "t", env))
            chunk()
        end
    `);

    // Load actual extension scripts
    const loadScript = async (code, name) => {
        lua.global.set('tempCode', code);
        await lua.doString(`loadScriptAsGlobal(tempCode, "${name}")`);
    };

    await loadScript(heightInitLua, "HeightInit");
    await loadScript(managerHeightLua, "HeightManager");
    await loadScript(managerTokenLua, "TokenManagerKel");

    return { lua, factory };
}

async function runAllTests() {
    console.log("Starting unit tests for Height-label...");

    // Test 1: Extension Launch & Initialization
    await runTest("Extension Launch Message", async () => {
        const { lua } = await setupLuaEnv();
        
        // Execute HeightInit.onInit
        await lua.doString("HeightInit.onInit()");
        
        // Verify chat message registered
        const messageCount = await lua.doString("return #ChatManager._launchMessages");
        assert.strictEqual(messageCount, 1);
        
        const messageText = await lua.doString("return ChatManager._launchMessages[1].text");
        assert.ok(messageText.includes("Height tracker v3.3.12.1"));
        lua.global.close();
    });

    // Test 2: HeightManager and TokenManagerKel Initialization
    await runTest("HeightManager/TokenManager Initialization", async () => {
        const { lua } = await setupLuaEnv();
        
        await lua.doString("HeightManager.onInit()");
        await lua.doString("TokenManagerKel.onInit()");
        
        // Verify Token.onWheel was hooked
        const hasOnWheel = await lua.doString("return Token.onWheel ~= nil");
        assert.strictEqual(hasOnWheel, true);
        
        // Verify options registered in OptionsManager
        const heightOpt = await lua.doString("return OptionsManager.getOption('HEIGHT')");
        assert.strictEqual(heightOpt, "alt");
        
        const hlfsOpt = await lua.doString("return OptionsManager.getOption('HLFS')");
        assert.strictEqual(hlfsOpt, "medium");
        
        lua.global.close();
    });

    // Test 3: Wheel Scroll Height Adjustments with Modifier Keys
    await runTest("onWheel Scroll Logic and Key Modifiers", async () => {
        const { lua } = await setupLuaEnv();
        await lua.doString("HeightManager.onInit()");
        
        // Setup mock token & combat tracker node
        await lua.doString(`
            myToken = createToken("token-123")
            ctNode = DB.createNode("combattracker.list.id-00001")
            CombatManager._tokenToCT["token-123"] = "combattracker.list.id-00001"
            CombatManager._ctToToken["combattracker.list.id-00001"] = myToken
        `);
        
        // Scenario 1: Default HEIGHT option is 'alt'. 
        // Scrolling WITHOUT Alt pressed should NOT change height.
        await lua.doString(`
            Input._alt = false
            Token.onWheel(myToken, 1) -- Scroll up
        `);
        let heightVal = await lua.doString("return HeightManager.getCTHeight(myToken)");
        assert.strictEqual(heightVal, 0); // No change because Alt is not pressed
        
        // Scenario 2: Scrolling WITH Alt pressed should increase height by grid distance units (5)
        await lua.doString(`
            Input._alt = true
            Token.onWheel(myToken, 1) -- First scroll creates the widget
            Token.onWheel(myToken, 1) -- Second scroll increases the height by 5
        `);
        heightVal = await lua.doString("return HeightManager.getCTHeight(myToken)");
        assert.strictEqual(heightVal, 5); // Increased by 5
        
        // Scenario 3: Scroll down 2 notches with Alt pressed
        await lua.doString(`
            Token.onWheel(myToken, -2) -- Scroll down 2 notches (-10)
        `);
        heightVal = await lua.doString("return HeightManager.getCTHeight(myToken)");
        assert.strictEqual(heightVal, -5); // 5 - 10 = -5
        
        // Scenario 4: Change option to 'shift'
        await lua.doString(`
            OptionsManager.setOption("HEIGHT", "shift")
            Input._alt = false
            Input._shift = true
            Token.onWheel(myToken, 3) -- Scroll up 3 notches (+15)
        `);
        heightVal = await lua.doString("return HeightManager.getCTHeight(myToken)");
        assert.strictEqual(heightVal, 10); // -5 + 15 = 10
        
        // Scenario 5: Change option to 'ctrl'
        await lua.doString(`
            OptionsManager.setOption("HEIGHT", "ctrl")
            Input._shift = false
            Input._ctrl = true
            Token.onWheel(myToken, -1) -- Scroll down 1 notch (-5)
        `);
        heightVal = await lua.doString("return HeightManager.getCTHeight(myToken)");
        assert.strictEqual(heightVal, 5); // 10 - 5 = 5
        
        // Scenario 6: Change option to 'wheel' (no modifier key pressed)
        await lua.doString(`
            OptionsManager.setOption("HEIGHT", "wheel")
            Input._ctrl = false
            Input._shift = false
            Input._alt = false
            Token.onWheel(myToken, 2) -- Scroll up 2 notches (+10)
        `);
        heightVal = await lua.doString("return HeightManager.getCTHeight(myToken)");
        assert.strictEqual(heightVal, 15); // 5 + 10 = 15
        
        lua.global.close();
    });

    // Test 4: Height Widget Creation, Styling, and Positions (Coordinate Calculations)
    await runTest("Height Widget Creation & Styling Coordinates", async () => {
        const { lua } = await setupLuaEnv();
        await lua.doString("HeightManager.onInit()");
        
        await lua.doString(`
            myToken = createToken("token-456", 60, 60)
            ctNode = DB.createNode("combattracker.list.id-00002")
            CombatManager._tokenToCT["token-456"] = "combattracker.list.id-00002"
            CombatManager._ctToToken["combattracker.list.id-00002"] = myToken
        `);
        
        // Set height in CT
        await lua.doString("HeightManager.setCTHeight(15, myToken)");
        
        // Create widget
        await lua.doString("HeightManager.createHeightWidget(myToken)");
        
        // Verify widget was created and added
        const widgetCount = await lua.doString("return #myToken._widgets");
        assert.strictEqual(widgetCount, 1);
        
        // Verify widget properties, specifically name, visibility, text, position and frame coordinates
        const widgetName = await lua.doString("return myToken._widgets[1]._name");
        assert.strictEqual(widgetName, "height_text");
        
        const widgetVisible = await lua.doString("return myToken._widgets[1]._visible");
        assert.strictEqual(widgetVisible, true);
        
        const widgetText = await lua.doString("return myToken._widgets[1]._text");
        assert.strictEqual(widgetText, "15 ft");
        
        const widgetFont = await lua.doString("return myToken._widgets[1]._font");
        assert.strictEqual(widgetFont, "height_medium"); // Default HLFS option is medium
        
        // Verify coordinate calculations & widget positioning
        const posRelation = await lua.doString("return myToken._widgets[1]._position.relation");
        const posX = await lua.doString("return myToken._widgets[1]._position.x");
        const posY = await lua.doString("return myToken._widgets[1]._position.y");
        assert.strictEqual(posRelation, "top");
        assert.strictEqual(posX, 0);
        assert.strictEqual(posY, 8);
        
        const frameName = await lua.doString("return myToken._widgets[1]._frame.name");
        const frameOffset1 = await lua.doString("return myToken._widgets[1]._frame.offset[1]");
        const frameOffset2 = await lua.doString("return myToken._widgets[1]._frame.offset[2]");
        const frameOffset3 = await lua.doString("return myToken._widgets[1]._frame.offset[3]");
        const frameOffset4 = await lua.doString("return myToken._widgets[1]._frame.offset[4]");
        assert.strictEqual(frameName, "tempmodmini");
        assert.strictEqual(frameOffset1, 10);
        assert.strictEqual(frameOffset2, 7);
        assert.strictEqual(frameOffset3, 10);
        assert.strictEqual(frameOffset4, 4);
        
        lua.global.close();
    });

    // Test 5: Height Label Formatting (visibility state based on height value)
    await runTest("Height Label Formatting & Visibility", async () => {
        const { lua } = await setupLuaEnv();
        await lua.doString("HeightManager.onInit()");
        
        await lua.doString(`
            myToken = createToken("token-789")
            ctNode = DB.createNode("combattracker.list.id-00003")
            CombatManager._tokenToCT["token-789"] = "combattracker.list.id-00003"
            CombatManager._ctToToken["combattracker.list.id-00003"] = myToken
            
            HeightManager.createHeightWidget(myToken)
        `);
        
        // Scenario 1: Initial height is 0. Widget should be invisible and have text "0 ft"
        let isVisible = await lua.doString("return myToken._widgets[1]._visible");
        assert.strictEqual(isVisible, false);
        
        // Scenario 2: Set height to 10. Update height widget. Text should be "10 ft" and visible
        await lua.doString(`
            HeightManager.setCTHeight(10, myToken)
            HeightManager.updateHeight(myToken)
        `);
        isVisible = await lua.doString("return myToken._widgets[1]._visible");
        let text = await lua.doString("return myToken._widgets[1]._text");
        assert.strictEqual(isVisible, true);
        assert.strictEqual(text, "10 ft");
        
        // Scenario 3: Set height back to 0. Widget should be invisible.
        await lua.doString(`
            HeightManager.setCTHeight(0, myToken)
            HeightManager.updateHeight(myToken)
        `);
        isVisible = await lua.doString("return myToken._widgets[1]._visible");
        assert.strictEqual(isVisible, false);
        
        lua.global.close();
    });

    // Test 6: Database handlers and TokenManagerKel sync
    await runTest("Database handlers and state updates", async () => {
        const { lua } = await setupLuaEnv();
        await lua.doString("HeightManager.onInit()");
        await lua.doString("TokenManagerKel.onInit()");
        
        await lua.doString(`
            myToken = createToken("token-abc")
            ctNode = DB.createNode("combattracker.list.id-00004")
            CombatManager._tokenToCT["token-abc"] = "combattracker.list.id-00004"
            CombatManager._ctToToken["combattracker.list.id-00004"] = myToken
            
            HeightManager.createHeightWidget(myToken)
        `);
        
        // Verify database height node exists
        const heightNodeVal = await lua.doString("return DB.findNode('combattracker.list.id-00004.height'):getValue()");
        assert.strictEqual(heightNodeVal, 0);
        
        // Let's set value on the DB node directly. This should trigger the database handler registered in manager_token.lua:
        // DB.addHandler("combattracker.list.*.height", "onUpdate", updateHeight);
        await lua.doString("DB.findNode('combattracker.list.id-00004.height'):setValue(20)");
        
        // Verify that the widget's text was updated automatically by the handler
        const widgetText = await lua.doString("return myToken._widgets[1]._text");
        const isVisible = await lua.doString("return myToken._widgets[1]._visible");
        assert.strictEqual(widgetText, "20 ft");
        assert.strictEqual(isVisible, true);
        
        lua.global.close();
    });

    // Test 7: addHolders to assign height node holders
    await runTest("Character sheet ownership and holder assignment", async () => {
        const { lua } = await setupLuaEnv();
        await lua.doString("HeightManager.onInit()");
        
        await lua.doString(`
            -- Setup combat tracker node representing a PC linked to a charsheet
            myToken = createToken("token-pc")
            ctNode = DB.createNode("combattracker.list.id-00005")
            ctNode:createChild("link", "string"):setValue("charsheet")
            ctNode:createChild("name", "string"):setValue("Deekin")
            
            -- Setup character sheet node with owner
            charNode = DB.createNode("charsheet.id-00001")
            charNode:createChild("name", "string"):setValue("Deekin")
            charNode:setOwner("Justine")
            
            -- Link them
            CombatManager._tokenToCT["token-pc"] = "combattracker.list.id-00005"
            CombatManager._ctToToken["combattracker.list.id-00005"] = myToken
            CombatManager._nodeToCT["charsheet.id-00001"] = "combattracker.list.id-00005"
            
            -- Run addHolders
            HeightManager.addHolders(myToken)
        `);
        
        // Verify heightNode has Justine as holder
        const hasHolder = await lua.doString("return DB.findNode('combattracker.list.id-00005.height')._holders['Justine']");
        assert.strictEqual(hasHolder, true);
        
        lua.global.close();
    });

    // Test 8: Font size option changes (HLFS)
    await runTest("Font size option change callback updates existing widgets", async () => {
        const { lua } = await setupLuaEnv();
        await lua.doString("HeightManager.onInit()");
        
        await lua.doString(`
            -- Create two combat tracker nodes and tokens
            myToken1 = createToken("token-font-1")
            ctNode1 = DB.createNode("combattracker.list.id-00006")
            CombatManager._tokenToCT["token-font-1"] = "combattracker.list.id-00006"
            CombatManager._ctToToken["combattracker.list.id-00006"] = myToken1
            HeightManager.createHeightWidget(myToken1)
            
            myToken2 = createToken("token-font-2")
            ctNode2 = DB.createNode("combattracker.list.id-00007")
            CombatManager._tokenToCT["token-font-2"] = "combattracker.list.id-00007"
            CombatManager._ctToToken["combattracker.list.id-00007"] = myToken2
            HeightManager.createHeightWidget(myToken2)
        `);
        
        // Initial font should be medium
        let font1 = await lua.doString("return myToken1._widgets[1]._font");
        let font2 = await lua.doString("return myToken2._widgets[1]._font");
        assert.strictEqual(font1, "height_medium");
        assert.strictEqual(font2, "height_medium");
        
        // Update font size option to large.
        // This should trigger the callback HLFS which iterates over children and sets the new font
        await lua.doString("OptionsManager.setOption('HLFS', 'large')");
        
        font1 = await lua.doString("return myToken1._widgets[1]._font");
        font2 = await lua.doString("return myToken2._widgets[1]._font");
        assert.strictEqual(font1, "height_large");
        assert.strictEqual(font2, "height_large");
        
        // Update font size option to small
        await lua.doString("OptionsManager.setOption('HLFS', 'small')");
        
        font1 = await lua.doString("return myToken1._widgets[1]._font");
        font2 = await lua.doString("return myToken2._widgets[1]._font");
        assert.strictEqual(font1, "height_small");
        assert.strictEqual(font2, "height_small");
        
        lua.global.close();
    });

    console.log("\n\x1b[32mAll unit tests passed successfully!\x1b[0m");
}

runAllTests().catch(err => {
    console.error("Unhandled test failure:", err);
    process.exit(1);
});
