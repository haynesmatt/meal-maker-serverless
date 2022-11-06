const Alexa = require('ask-sdk')
const listIsEmpty = '#list_is_empty#'
const permissions = ['write::alexa:household:list'];

const listStatuses = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
};

const LaunchRequestHandler = {
  
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
    },
    handle(handlerInput) {
        const attributesManager = handlerInput.attributesManager;
        const sessionAttributes = attributesManager.getSessionAttributes();
        
        const speechText = getWelcomeMessage(sessionAttributes)
            + " " 
            
        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .withAskForPermissionsConsentCard(permissions)
            .getResponse();
  },
};


const CompleteIngredientHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    return request.type === 'IntentRequest' && request.intent.name === 'CompleteIngredientIntent';
  },
  async handle(handlerInput) {
    const responseBuilder = handlerInput.responseBuilder;

    let speechOutput;
    console.info('Starting to formulate a recipe.');
    try {
      const result = await completeIngredientListAction(handlerInput);
      if (!result) {
        speechOutput = 'Alexa List permissions are missing. You can grant permissions within the Alexa app.';
        return responseBuilder
          .speak(speechOutput)
          .withAskForPermissionsConsentCard(permissions)
          .getResponse();
      } else if (result === listIsEmpty) {
        speechOutput = 'I could not return a recipe. Your ingredient list is empty.';
      } else {
        speechOutput = `I successfully completed ${result.value}, which was your top todo.  Bye for now!`;
      }
    } catch (err) {
      speechOutput = 'I could not formulate a recipe.  Please try again later';
    }
    return responseBuilder
      .speak(speechOutput)
      .getResponse();
  },
};

/*May need another IntentHandler if we decide to use time of day and API does 
not sort by breakfast, lunch, dinner, dessert, etc.*/

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    const speechText = 'This is Meal Maker. I will find a recipe for ingredients you already have in your home. To get started say I\'m hungry';

    return handlerInput.responseBuilder
      .speak(speechText)
      .reprompt(speechText)
      .getResponse();
  },
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent'
        || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent');
  },
  handle(handlerInput) {
    const speechText = 'Goodbye!';

    return handlerInput.responseBuilder
      .speak(speechText)
      .getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    console.log(`Session ended with reason: ${handlerInput.requestEnvelope.request.reason}`);

    return handlerInput.responseBuilder.getResponse();
  },
};

const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'Sorry, I don\'t know about that. Please try again.';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        const speakOutput = 'Sorry, I had trouble doing what you asked. Please try again.';
        console.log(`~~~~ Error handled: ${JSON.stringify(error)}`);

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

function getWelcomeMessage(sessionAttributes) {

  let speechText = "";

  if (sessionAttributes.isNew) {
    speechText += "<say-as interpret-as=\"interjection\">Hello!</say-as> ";
    speechText += "Welcome to Meal Maker!";
    speechText += "I'll help you find the right recipe all from the comfort of your own home.";
    speechText += "To make it easier, you can list the ingredients you have at home,";
    speechText += "just check the Alexa app.";
  }
  else {
      speechText += "Welcome back to Meal Maker!";
      speechText += "Make sure to list the ingredients you have in the Alexa app.";
  }
  return speechText;
}

// helpers

/*
* List API to retrieve the ingredient list.
*/
async function getIngredientListID(handlerInput) {
  // check session attributes to see if it has already been fetched
  const attributesManager = handlerInput.attributesManager;
  const sessionAttributes = attributesManager.getSessionAttributes();
  let listId;

  if (!sessionAttributes.todoListId) {
    // lookup the id for the ingredient list
    const listClient = handlerInput.serviceClientFactory.getListManagementServiceClient();
    const retList = await listClient.getListsMetadata();
    if (!retList) {
      console.log('permissions are not defined');
      return null;
    }
    for (let i = 0; i < retList.lists.length; i += 1) {
      console.log(`found ${retList.lists[i].name} with id ${retList.lists[i].listId}`);
      const decodedListId = Buffer.from(retList.lists[i].listId, 'base64').toString('utf8');
      console.log(`decoded listId: ${decodedListId}`);
      // The default lists (To-Do and Shopping List) list_id values are base-64 encoded strings with these formats:
      //  <Internal_identifier>-TASK for the to-do list
      //  <Internal_identifier>-SHOPPING_ITEM for the shopping list
      // Developers can base64 decode the list_id value and look for the specified string at the end. This string is constant and agnostic to localization.
      if (decodedListId.endsWith('-TASK')) {
        // since we're looking for the default to do list, it's always present and always active
        listId = retList.lists[i].listId;
        break;
      }
    }
  }
  attributesManager.setSessionAttributes(sessionAttributes);
  console.log(JSON.stringify(handlerInput));
  return listId; // sessionAttributes.IngredientListId;
}

/*
* List API to delete the top todo item.
*/
async function completeIngredientListAction(handlerInput) {
  const listClient = handlerInput.serviceClientFactory.getListManagementServiceClient();
  // get the list
  const listId = await getIngredientListID(handlerInput);
  const list = await listClient.getList(listId, listStatuses.ACTIVE);
  // if the list doesn't exist, no permissions or has no items
  if (!list) {
    return null;
  } else if (!list.items || list.items.length === 0) {
    return (listIsEmpty);
  }

  // return list
  const items = list.items();
  const updateRequest = {
    value: items.value,
    status: listStatuses.COMPLETED,
    version: items.version,
  };
  return listClient.updateListItems(listId, items.id, updateRequest);
}

const skillBuilder = Alexa.SkillBuilders.custom();
exports.handler = skillBuilder
  .addRequestHandlers(
    CancelAndStopIntentHandler,
    HelpIntentHandler,
    LaunchRequestHandler,
    CompleteIngredientHandler,
    ErrorHandler,
    SessionEndedRequestHandler,
    FallbackIntentHandler
  )
  .addErrorHandlers(ErrorHandler)
  .withApiClient(new Alexa.DefaultApiClient())
  .withCustomUserAgent('cookbook/list-access/v1')
  .lambda();
