import fs from 'fs';
import rp from 'request-promise';
import { parseString as parseXml } from 'xml2js';
import moment from 'moment';
import { map as asyncMap } from 'async';

const filename = './postnummer.csv';
const directionApiKey = 'AIzaSyDmy5T5Ueb8ZLDwwje72TqL3lsXQRKRF4Y';
const directionUrl = 'https://maps.googleapis.com/maps/api/directions/json';

const R = 6371e3; // gives d in metres

if (Number.prototype.toRadians === undefined) {
  Number.prototype.toRadians = function () {
    return this * Math.PI / 180;
  };
}

const distanceBetween = (c1, c2) => {
  const φ1 = c1.lat.toRadians();
  const φ2 = c2.lat.toRadians();
  const λ1 = c1.long.toRadians();
  const λ2 = c2.long.toRadians();

  const x = (λ2 - λ1) * Math.cos((φ1 + φ2) / 2);
  const y = (φ2 - φ1);
  return Math.sqrt(x * x + y * y) * R;
};

const findNearestPostalCode = (pos, postalCodes) => {
  let closest = Number.MAX_SAFE_INTEGER;
  let closestPostalCode = {};
  postalCodes.forEach(postalCode => {
    const distance = distanceBetween(pos, postalCode);
    if (distance < closest) {
      closest = distance;
      closestPostalCode = postalCode;
    }
  });
  return closestPostalCode
};

const parsePostalCodes = () => {
  const file = fs.readFileSync(filename, 'UTF-8');

  return file
    .split('\n')
    .map(line => line.split('\t'))
    .map(fields => ({
      postcode: fields[0],
      postaddr: fields[1],
      lat: parseFloat(fields[9]),
      long: parseFloat(fields[10]),
    }));
};

const parseXmlPromise = (xml) =>
  new Promise(function (resolve, reject) {
    parseXml(xml, function (err, result) {
      if (err) {
        reject(err);
      }
      else {
        resolve(result);
      }
    });
  });

const getWeather = async (postalCode, time) => {
  const options = {
    uri: `http://www.yr.no/sted/Norge/postnummer/${postalCode.postcode}/varsel.xml`
  };


  try {
    const xml = await rp(options);

    const result = await parseXmlPromise(xml);
    const periods = result.weatherdata.forecast[0].tabular[0].time
      .filter(period => time.isBetween(period.$.from, period.$.to, null, '[)'))
      .map(period => ({
        ...postalCode,
        from: period.$.from,
        to: period.$.to,
        symbol: period.symbol[0].$,
        precipitation: period.precipitation[0].$,
        temperature: period.temperature[0].$.value,
      }));
    if(periods.length > 0){
      return periods[0];
    }
  } catch (err) {
    //console.log('Error getting weather for postcode ', postalCode)
  }
  return undefined;

};

const getDirections = async (origin, destination, startTime) => {
  const time = startTime.clone();
  const options = {
    uri: `${directionUrl}?origin=${origin}&destination=${destination}&key=${directionApiKey}`
  };
  const directions = JSON.parse(await rp(options));
  const steps = directions.routes[0].legs[0].steps;
  return steps.map(step => ({
    meters: step.distance.value,
    seconds: step.duration.value,
    start:{
      lat: step.start_location.lat,
      long: step.start_location.lng,
      time: time.clone(),
    },
    end:{
      lat: step.end_location.lat,
      long: step.end_location.lng,
      time: time.add(step.duration.value, 'seconds').clone()
    }
  }));
};

const getDriveWeather = async () => {
  const startTime = moment('2017-07-28T10:30:00');
  const postalCodes = parsePostalCodes();
  const directions = await getDirections('Bryggja, No', 'Lokebergveien 99, Haslum', startTime);

  const weathers = [];

  for(let i=0; i<directions.length; i++){
    const step = directions[i];
    const postalCode = findNearestPostalCode(step.start, postalCodes);
    const weather = await getWeather(postalCode, step.start.time);
    if(weather){
      weathers.push({
        ...step,
        postalCode,
        weather,
      })
    }
  }

  weathers.forEach(step =>{
    console.log(`${step.start.time.format('D/M, HH:mm:ss')}: ${step.weather.symbol.name} på ${step.postalCode.postaddr}`);
  })
};

getDriveWeather();


