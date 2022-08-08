const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { StatusCodes } = require('http-status-codes');

const ddb = new DynamoDBClient();

exports.handler = async (event) => {
  try {
    const input = JSON.parse(event.body);
    const user = await exports.getUserRecord(event.requestContext.authorizer.userId);
    if (!user) {
      console.error('The caller is not a registered user');
      return {
        statusCode: StatusCodes.CONFLICT,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'You are not a registered user.' })
      };
    }

    if(!user.customers.find(c => c.id == input.id)){
      await exports.addTenantToUserRecord(event.requestContext.authorizer.userId, input.id, input.roles, input.makeActive);
    }

    return {
      statusCode: StatusCodes.NO_CONTENT,
      headers: { 'Access-Control-Allow-Origin': '*' }
    }
  } catch (err) {
    console.error(err);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Something went wrong.' })
    };
  }
};

exports.getUserRecord = async (userId) => {
  const command = new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: userId,
      sk: 'user#'
    })
  });

  const result = await ddb.send(command);
  if (result?.Item) {
    return unmarshall(result.Item);
  }
};

exports.addTenantToUserRecord = async (userId, customerId, roles, makeActiveTenant) => {
  const params = {
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: userId,
      sk: 'user#'
    }),
    UpdateExpression: 'SET #customers = list_append(#customers, :newCustomer)',
    ExpressionAttributeNames: {
      '#customers': 'customers'
    },
    ExpressionAttributeValues: {
      ':newCustomer': [ { id: customerId, roles }]
    }
  };

  if(makeActiveTenant){
    params.UpdateExpression = `${params.UpdateExpression}, #active.#customerId = :customerId`;
    params.ExpressionAttributeNames['#active'] = 'active';
    params.ExpressionAttributeNames['#customerId'] = 'customerId';
    params.ExpressionAttributeValues[':customerId'] = customerId;
  }

  params.ExpressionAttributeValues = marshall(params.ExpressionAttributeValues);

  await ddb.send(new UpdateItemCommand(params));
};