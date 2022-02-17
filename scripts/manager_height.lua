-- KEL: Change your values of measures here, maybe think about a space at the beginning of measure:
UNIT_OF_MEASURE = " ft";

--[[
	Copyright (C) 2018 Ken L.
	Licensed under the GPL Version 3 license.
	http://www.gnu.org/licenses/gpl.html
	This script is free software: you can redistribute it and/or modify
	it under the terms of the GNU General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This script is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU General Public License for more details.
]]--

--[[
	on Init
]]--
function onInit()
	Token.onWheel = onWheel;
	registerOptions();
end

function registerOptions()
	OptionsManager.registerOption2("HEIGHT",false, "option_header_height", "option_label_Height_Hotkey", "option_entry_cycler",
		{ labels = "option_val_shift|option_val_ctrl|option_val_wheel", values = "shift|ctrl|wheel", baselabel = "option_val_alt", baseval = "alt", default = "alt" });
	OptionsManager.registerOption2("HLFS",false, "option_header_height", "option_label_Height_Font_Size", "option_entry_cycler",
		{ labels = "option_val_large|option_val_small", values = "large|small", baselabel = "option_val_medium", baseval = "medium", default = "medium" });
	OptionsManager.registerCallback("HLFS", onFontSizeOptionChanged);
end

--[[
	Replace the default onWheel token function with our own
]]--
-- Compare with onWheelHelper from TokenManager
function onWheel(target, notches)
	local sOptHeight = OptionsManager.getOption("HEIGHT");
	local bHeight = false;
	if sOptHeight == "shift" and Input.isShiftPressed() then
		bHeight = true;
	elseif sOptHeight == "ctrl" and Input.isControlPressed() then
		bHeight = true;
	elseif sOptHeight == "alt" and Input.isAltPressed() then
		bHeight = true;
	elseif sOptHeight == "wheel" and not Input.isShiftPressed() and not Input.isControlPressed() and not Input.isAltPressed() then
		bHeight = true;
	end
	if bHeight then
		if not hasHeightWidget(target) then
			createHeightWidget(target);
		else
			modifyHeight(notches, target);
		end
		return true;
	end
end

function setupToken(token)
	if not hasHeightWidget(token) then
		createHeightWidget(token);
		updateHeight(token);
	else
		local ct = hasCT(token);
		if ct then
			if Session.IsHost then
				addHolders(token);
			end
		end
	end
end

function createHeightWidget(token)
	if hasCT(token) then
		local height = getCTHeight(token);
		local wdg = token.addTextWidget(getWidgetFontName(), height .. UNIT_OF_MEASURE);
		if wdg then
			wdg.setVisible(height == 0);
			wdg.setName("height_text");
			wdg.setPosition("top", 0, 8);
			wdg.setFrame('tempmodmini', 10, 7, 10, 4);
			wdg.setColor('00000000');
			wdg.bringToFront();
			-- make CT height field if it doesn't exist;
			local ct = hasCT(token);
			if ct then
				ct.createChild("height", "number");
				if Session.IsHost then
					addHolders(token);
				end
			end
		end
	end
end

function getWidgetFontName()
	return "height_" .. OptionsManager.getOption("HLFS");
end

function onFontSizeOptionChanged()
	local sWidgetFontName = getWidgetFontName();
	for k, v in pairs(DB.getChildren("combattracker.list")) do
		if k ~= "public" then
			local token = CombatManager.getTokenFromCT(v);
			local wWidget = hasHeightWidget(token);
			if wWidget then
				wWidget.setFont(sWidgetFontName);
			end
		end
	end
end

--[[
	We need to check if the data source is in fact owned by any one individual, if it is, then
	make the 'height' field of the CT entry owned by them as well.

	NOTE: we should in theory also hang on to identity ownership as when the identity shifts, we
	should change the owner of the height node as well to this new identity.
]]--
function addHolders(token)
	local ct = hasCT(token);
	local heightNode, charSheets, owner, iden, cl, cn;

	if ct then
		heightNode = ct.createChild("height","number");
		if heightNode and Session.IsHost then
			-- get datasource, try to find the charsheet
			-- if there's a charsheet, then get the list of users
			-- find all identities own by each user, if an identity owned by a user
			-- is equal to the name field on the ct, then make that user a holder
			if ct.getChild('link').getValue() == 'charsheet'then
				iden = ct.getChild('name').getValue();

				-- try iterating through char sheets
				charSheets = DB.findNode('charsheet');
				if charSheets then
					cl = charSheets.getChildren();
					for _, v in pairs(cl) do
						cn = v.getChild('name');
						if cn then
							cn = cn.getValue();
							if cn == iden then
								owner = v.getOwner();
								break;
							end
						end
					end
					if owner then
						heightNode.addHolder(owner,true);
					end
				end
			end
		end
	end
end

function modifyHeight(inc, token)
	local height = getCTHeight(token);
	local incrementSize = GameSystem.getDistanceUnitsPerGrid();
	height = height + (inc * incrementSize);
	setCTHeight(height, token);
end

--[[
	Return CT if the token is on the CT else, nil
]]--
function hasCT(token)
	local ct = CombatManager.getCTFromToken(token);
	return ct;
end

--[[
	Contrary to the name, this function update the widget display
	given the token
]]--
function updateHeight(token)
	local wdg = hasHeightWidget(token);
	local ct = hasCT(token);
	if wdg and ct then
		local height = getCTHeight(token);
		local txtHeight = "";

		if height == 0 then
			txtHeight = '';
			wdg.setVisible(false);
		else
			txtHeight = height .. txtHeight .. UNIT_OF_MEASURE;
			wdg.setVisible(true);
		end
		wdg.setText(txtHeight);
		wdg.bringToFront();
	end
end

--[[
	Set our exact height to the given value in the CT
	entry if available, else create one and set the
	height. If not on the CT, nothing
]]--
function setCTHeight(height,token)
	local ct = CombatManager.getCTFromToken(token);

	if ct then
		local heightNode = ct.createChild("height","number");
		if heightNode then
			if heightNode then
				heightNode.setValue(height);
			end
		end
	end

end


--[[
	Get the height value from the CT entry if available, else
	create one, and set the height to 0, and return 0. If not
	on the CT, nothing
]]--
function getCTHeight(token)
	local ct = CombatManager.getCTFromToken(token);

	if ct then
		local heightNode = ct.createChild("height","number");
		if heightNode then
			local height = tonumber(heightNode.getValue());
			return height;
		end
	end

	return 0;
end

--Return the height widget if the token has it, else nil.
function hasHeightWidget(token)
	return token.findWidget("height_text");
end