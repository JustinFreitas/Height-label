-- 
-- Please see the license.html file included with this distribution for 
-- attribution and copyright information.
--

function onInit()
	OldupdateTooltip = TokenManager.updateTooltip;
	TokenManager.updateTooltip = updateTooltip;
	OldupdateNameHelper = TokenManager.updateNameHelper;
	TokenManager.updateNameHelper = updateNameHelper;
	OldupdateVisibilityHelper = TokenManager.updateVisibilityHelper;
	TokenManager.updateVisibilityHelper = updateVisibilityHelper;
	OldupdateOwnerHelper = TokenManager.updateOwnerHelper;
	TokenManager.updateOwnerHelper = updateOwnerHelper;
	OldupdateActiveHelper = TokenManager.updateActiveHelper;
	TokenManager.updateActiveHelper = updateActiveHelper;
	OldupdateFactionHelper = TokenManager.updateFactionHelper;
	TokenManager.updateFactionHelper = updateFactionHelper;
	OldupdateEffectsHelper = TokenManager.updateEffectsHelper;
	TokenManager.updateEffectsHelper = updateEffectsHelper;
	
	DB.addHandler("charsheet.*", "onDelete", deleteOwner);
	-- KEL Height state update
	DB.addHandler("combattracker.list.*.height", "onUpdate", updateHeight);
	DB.addHandler("combattracker.list.*.height", "onAdd", updateHeight);
end

-- KEL Height
function updateHeight(nodeField)
	local nodeCT = nodeField.getParent();
	local tokenCT = CombatManager.getTokenFromCT(nodeCT);
	if (HeightManager) then
		HeightManager.updateHeight(tokenCT); 
	end
end
function updateTooltip(tokenCT, nodeCT)
	-- KEL
	if (HeightManager) then
		HeightManager.setupToken(tokenCT); 
	end
	--END
	OldupdateTooltip(tokenCT, nodeCT);
end

function updateNameHelper(tokenCT, nodeCT)
	OldupdateNameHelper(tokenCT, nodeCT);
	-- KEL
	if (HeightManager) then
		HeightManager.setupToken(tokenCT); 
	end
end

function updateVisibilityHelper(tokenCT, nodeCT)
	OldupdateVisibilityHelper(tokenCT, nodeCT);
	-- KEL
	if (HeightManager) then
		HeightManager.setupToken(tokenCT); 
	end
end
-- KEL overwrite original function to avoid doubling steps
function deleteOwner(nodePC)
	local nodeCT = CombatManager.getCTFromNode(nodePC);
	if nodeCT then
		local tokenCT = CombatManager.getTokenFromCT(nodeCT);
		if tokenCT then
			-- KEL
			if (HeightManager) then
				HeightManager.setupToken(tokenCT); 
			end
			if Session.IsHost then
				tokenCT.setOwner();
				TokenManager.updateTokenColor(tokenCT);
			end
		end
	end
end
function updateOwnerHelper(tokenCT, nodeCT)
	OldupdateOwnerHelper(tokenCT, nodeCT);
	-- KEL
	if (HeightManager) then
		HeightManager.setupToken(tokenCT); 
	end
end
function updateActiveHelper(tokenCT, nodeCT)
	OldupdateActiveHelper(tokenCT, nodeCT);
	-- KEL
	if (HeightManager) then
		HeightManager.setupToken(tokenCT); 
	end
end
function updateFactionHelper(tokenCT, nodeCT)
	OldupdateFactionHelper(tokenCT, nodeCT);
	-- KEL
	if (HeightManager) then
		HeightManager.setupToken(tokenCT); 
	end
end
function updateEffectsHelper(tokenCT, nodeCT)
	OldupdateEffectsHelper(tokenCT, nodeCT);
	-- KEL make sure our height is atop any status widgets
	if (HeightManager) then
		HeightManager.setupToken(tokenCT); 
	end	
end
