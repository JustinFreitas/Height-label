function onInit()
	-- Extension launch message
	local msg = {sender = "", font = "emotefont"};
    msg.text = "Height tracker v3.3.12.1 for CoreRPG rulesets. \rBy Madman and Kelrugem, original code by Ken L. Use SHIFT+MouseWheelScroll to adjust height, CTRL+MouseWheelScroll to adjust orientation and ALT+MouseWheelScroll to change the size."
	ChatManager.registerLaunchMessage(msg);
end
